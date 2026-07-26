import assert from "node:assert/strict";
import { describe, it } from "node:test";

// The field contract these tests pin down is documented for operators in
// deploy/vps/README.md ("Logs"). A change here is a change to what every
// log-shipping rule against this deployment parses.
process.env.LOG_LEVEL = "trace";
process.env.REMIT_SERVICE_NAME = "test-service";

type Line = Record<string, unknown>;

const originalWrite = process.stdout.write.bind(process.stdout);
const written: string[] = [];
let capturing = false;

// pino uses `process.stdout` directly when its `write` has been replaced, and
// the real fd otherwise — so the hook has to be in place before the import
// below, and it passes writes through whenever a test is not capturing so the
// test runner's own output still reaches the terminal.
process.stdout.write = ((
	chunk: string | Uint8Array,
	...rest: unknown[]
): boolean => {
	if (capturing && typeof chunk === "string") {
		written.push(chunk);
		return true;
	}
	return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

const { createLogger, logger } = await import("./logger.js");

const capture = (emit: () => void): Line[] => {
	written.length = 0;
	capturing = true;
	try {
		emit();
	} finally {
		capturing = false;
	}
	return written
		.join("")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Line);
};

const one = (emit: () => void): Line => {
	const lines = capture(emit);
	assert.equal(lines.length, 1, "expected exactly one log line");
	return lines[0];
};

describe("log output", () => {
	it("writes one JSON object per line on stdout", () => {
		const log = createLogger();
		const lines = capture(() => {
			log.warn("first");
			log.warn("second");
		});
		assert.deepEqual(
			lines.map((line) => line.msg),
			["first", "second"],
		);
	});

	it("carries level, time, service and msg on every line", () => {
		const line = one(() => createLogger().warn("hello"));
		assert.equal(line.level, "warn");
		assert.equal(line.service, "test-service");
		assert.equal(line.msg, "hello");
		assert.equal(typeof line.time, "string");
		assert.equal(
			new Date(line.time as string).toISOString(),
			line.time,
			"time is RFC 3339 in UTC",
		);
	});

	it("names each level in lowercase, with fatal as its own name", () => {
		const log = createLogger();
		const levels = capture(() => {
			log.trace("t");
			log.debug("d");
			log.info("i");
			log.warn("w");
			log.error("e");
			log.fatal("f");
		}).map((line) => line.level);
		assert.deepEqual(levels, [
			"trace",
			"debug",
			"info",
			"warn",
			"error",
			"fatal",
		]);
	});

	it("puts bindings at the top level, message first", () => {
		const line = one(() =>
			createLogger().error(
				{ error: "boom", messageId: "m1" },
				"Failed to parse message",
			),
		);
		assert.equal(line.msg, "Failed to parse message");
		assert.equal(line.error, "boom");
		assert.equal(line.messageId, "m1");
	});

	it("emits an empty msg when only bindings are given", () => {
		const line = one(() => createLogger().warn({ count: 3 }));
		assert.equal(line.msg, "");
		assert.equal(line.count, 3);
	});

	it("accepts bindings after a message", () => {
		const line = one(() =>
			createLogger().warn("watch out", { reason: "slow" }),
		);
		assert.equal(line.msg, "watch out");
		assert.equal(line.reason, "slow");
	});

	it("ignores a non-object second argument after a message", () => {
		const line = one(() =>
			(createLogger().warn as (msg: string, obj?: unknown) => void)(
				"plain",
				"not-bindings",
			),
		);
		assert.equal(line.msg, "plain");
	});

	it("child bindings appear on every line the child writes", () => {
		const child = createLogger().child({ queue: "imap" });
		const line = one(() => child.warn({ done: true }, "child log"));
		assert.equal(line.queue, "imap");
		assert.equal(line.done, true);
		assert.equal(line.msg, "child log");
	});

	it("a child inherits the bindings its parent had when it was created", () => {
		const parent = createLogger();
		parent.setBindings({ accountId: "a1" });
		const child = parent.child({ queue: "smtp" });
		const line = one(() => child.warn("nested"));
		assert.equal(line.accountId, "a1");
		assert.equal(line.queue, "smtp");
	});

	it("setBindings applies to later lines and replaces a key without repeating it", () => {
		const log = createLogger();
		log.setBindings({ requestId: "r1", path: "/one" });
		const first = one(() => log.warn("first request"));
		assert.equal(first.requestId, "r1");
		assert.equal(first.path, "/one");

		log.setBindings({ requestId: "r2", path: "/two" });
		const [raw] = capture(() => log.warn("second request"));
		assert.equal(raw.requestId, "r2");
		assert.equal(raw.path, "/two");

		const repeats = written.join("").match(/"requestId"/g) ?? [];
		assert.equal(repeats.length, 1, "a rebound key is written once, not twice");
	});

	it("bindings set on one logger do not leak into another", () => {
		const first = createLogger();
		const second = createLogger();
		first.setBindings({ owner: "first" });
		const line = one(() => second.warn("independent"));
		assert.equal(line.owner, undefined);
	});

	it("the shared logger writes the same shape", () => {
		const line = one(() => logger.warn("shared"));
		assert.equal(line.service, "test-service");
		assert.equal(line.msg, "shared");
	});

	it("serialises an Error under err", () => {
		const line = one(() =>
			createLogger().error({ err: new Error("kaboom") }, "handler failed"),
		);
		const err = line.err as Record<string, unknown>;
		assert.equal(err.message, "kaboom");
		assert.equal(err.type, "Error");
		assert.equal(typeof err.stack, "string");
	});

	it("carries no pid or hostname", () => {
		const line = one(() => createLogger().warn("lean"));
		assert.equal(line.pid, undefined);
		assert.equal(line.hostname, undefined);
	});
});
