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

const { createLogger, logger, withLogContext } = await import("./logger.js");

const parse = (): Line[] =>
	written
		.join("")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Line);

const capture = (emit: () => void): Line[] => {
	written.length = 0;
	capturing = true;
	try {
		emit();
	} finally {
		capturing = false;
	}
	return parse();
};

const captureAsync = async (emit: () => Promise<void>): Promise<Line[]> => {
	written.length = 0;
	capturing = true;
	try {
		await emit();
	} finally {
		capturing = false;
	}
	return parse();
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

	it("a call-site field shadowing a child binding is written once", () => {
		const child = createLogger().child({ queue: "from-child" });
		const [line] = capture(() => child.warn({ queue: "from-callsite" }, "x"));
		assert.equal(line.queue, "from-callsite");
		const repeats = written.join("").match(/"queue"/g) ?? [];
		assert.equal(repeats.length, 1, "one key per line, not two");
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

	it("carries no pid or hostname", () => {
		const line = one(() => createLogger().warn("lean"));
		assert.equal(line.pid, undefined);
		assert.equal(line.hostname, undefined);
	});

	it("drops a call-site field using a reserved name", () => {
		const [line] = capture(() =>
			createLogger().warn(
				{ level: "trace", time: "1999", service: "other", msg: "hijack" },
				"collide",
			),
		);
		assert.equal(line.level, "warn");
		assert.equal(line.service, "test-service");
		assert.equal(line.msg, "collide");
		for (const key of ['"level"', '"time"', '"service"', '"msg"']) {
			const repeats = written.join("").match(new RegExp(key, "g")) ?? [];
			assert.equal(repeats.length, 1, `${key} is written once`);
		}
	});
});

// The shapes the worker and backend failure paths actually produce. A contract
// test that asserts a key no call site writes is how a serialisation regression
// stays green, so each case below names the call site it mirrors.
describe("error serialisation", () => {
	it("expands an Error logged under error — imap-worker/src/index.ts", () => {
		const line = one(() =>
			createLogger().error(
				{ error: new Error("boom"), messageId: "m1" },
				"Event processing failed",
			),
		);
		const error = line.error as Record<string, unknown>;
		assert.equal(error.type, "Error");
		assert.equal(error.message, "boom");
		assert.match(String(error.stack), /^Error: boom\n\s+at /);
		assert.equal(line.messageId, "m1");
	});

	it("keeps a subclass name and its own properties", () => {
		class UpstreamError extends Error {
			readonly statusCode = 502;
		}
		const line = one(() =>
			createLogger().error({ error: new UpstreamError("gone") }, "failed"),
		);
		const error = line.error as Record<string, unknown>;
		assert.equal(error.type, "UpstreamError");
		assert.equal(error.statusCode, 502);
	});

	it("leaves a string alone — backend/src/error.ts", () => {
		const failure = new Error("ElectroError: bad key");
		const line = one(() =>
			createLogger().error(
				{ error: failure.message, name: failure.name, stack: failure.stack },
				"Unhandled Error",
			),
		);
		assert.equal(line.error, "ElectroError: bad key");
		assert.equal(line.name, "Error");
		assert.match(String(line.stack), /^Error: ElectroError: bad key\n\s+at /);
	});

	it("leaves a plain object alone — backend/src/response.ts", () => {
		const line = one(() =>
			createLogger().error(
				{ "problematicValue_/items": { path: "/items", error: "too long" } },
				"Response validation failed",
			),
		);
		assert.deepEqual(line["problematicValue_/items"], {
			path: "/items",
			error: "too long",
		});
	});

	it("expands an Error under err too", () => {
		const line = one(() =>
			createLogger().error({ err: new Error("kaboom") }, "handler failed"),
		);
		const err = line.err as Record<string, unknown>;
		assert.equal(err.type, "Error");
		assert.equal(err.message, "kaboom");
	});
});

describe("withLogContext", () => {
	it("adds its bindings to every line written inside it", () => {
		const line = one(() =>
			withLogContext({ requestId: "r1", path: "/one" }, () => {
				logger.warn("inside");
			}),
		);
		assert.equal(line.requestId, "r1");
		assert.equal(line.path, "/one");
	});

	it("does not leak past the scope", () => {
		withLogContext({ requestId: "r1" }, () => {});
		const line = one(() => logger.warn("outside"));
		assert.equal(line.requestId, undefined);
	});

	it("keeps overlapping scopes apart across awaits", async () => {
		const request = (id: string, delayMs: number) =>
			withLogContext({ requestId: id }, async () => {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
				logger.warn(`handled ${id}`);
			});

		// The slow request opens its scope first and logs last, which is exactly
		// the interleaving a shared mutable binding gets wrong.
		const lines = await captureAsync(async () => {
			await Promise.all([request("slow", 10), request("fast", 1)]);
		});

		assert.deepEqual(
			lines.map((line) => [line.msg, line.requestId]),
			[
				["handled fast", "fast"],
				["handled slow", "slow"],
			],
		);
	});

	it("nests, adding to the scope it runs inside", () => {
		const line = one(() =>
			withLogContext({ requestId: "r1" }, () =>
				withLogContext({ accountId: "a1" }, () => {
					logger.warn("nested scope");
				}),
			),
		);
		assert.equal(line.requestId, "r1");
		assert.equal(line.accountId, "a1");
	});

	it("a call-site field wins over a scope binding, and is written once", () => {
		const [line] = capture(() =>
			withLogContext({ requestId: "from-scope" }, () => {
				logger.warn({ requestId: "from-callsite" }, "x");
			}),
		);
		assert.equal(line.requestId, "from-callsite");
		const repeats = written.join("").match(/"requestId"/g) ?? [];
		assert.equal(repeats.length, 1);
	});
});
