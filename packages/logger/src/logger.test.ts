import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createJsonLogger,
	createLogger,
	type LogBindings,
	logger,
	noopLogger,
	setLogger,
	withLogContext,
} from "./index.js";

const collect = (
	options: Parameters<typeof createJsonLogger>[0] = {},
): { lines: LogBindings[]; log: ReturnType<typeof createJsonLogger> } => {
	const lines: LogBindings[] = [];
	const log = createJsonLogger({
		...options,
		write: (line) => lines.push(JSON.parse(line) as LogBindings),
	});
	return { lines, log };
};

describe("createJsonLogger", () => {
	it("writes level, time, service, bindings and msg as one JSON object", () => {
		const { lines, log } = collect({ service: "api" });
		log.warn({ messageId: "m1" }, "slow");
		assert.equal(lines.length, 1);
		const [line] = lines;
		assert.equal(line?.level, "warn");
		assert.equal(line?.service, "api");
		assert.equal(line?.messageId, "m1");
		assert.equal(line?.msg, "slow");
		assert.equal(new Date(String(line?.time)).toISOString(), line?.time);
	});

	it("drops lines below its level and everything when silent", () => {
		const { lines, log } = collect({ level: "warn" });
		log.info("dropped");
		log.error("kept");
		assert.deepEqual(
			lines.map((line) => line.msg),
			["kept"],
		);
		const silent = collect({ level: "silent" });
		silent.log.fatal("dropped");
		assert.equal(silent.lines.length, 0);
	});

	it("expands an Error under error, keeping its cause", () => {
		const { lines, log } = collect();
		log.error(
			{ error: new Error("outer", { cause: new TypeError("inner") }) },
			"failed",
		);
		const error = lines[0]?.error as LogBindings;
		assert.equal(error.type, "Error");
		assert.equal(error.message, "outer");
		assert.equal((error.cause as LogBindings).type, "TypeError");
	});

	it("writes a circular binding instead of throwing", () => {
		const { lines, log } = collect();
		const loop: LogBindings = { name: "loop" };
		loop.self = loop;
		log.warn({ loop, size: 10n }, "odd values");
		assert.deepEqual(lines[0]?.loop, { name: "loop", self: "[Circular]" });
		assert.equal(lines[0]?.size, "10");
	});

	it("keeps a reserved name from retagging the line", () => {
		const { lines, log } = collect();
		log.warn({ level: "trace", msg: "hijack" }, "collide");
		assert.equal(lines[0]?.level, "warn");
		assert.equal(lines[0]?.msg, "collide");
	});
});

describe("the logger handle", () => {
	it("writes through whatever the composition root installs, even when taken earlier", () => {
		const child = createLogger().child({ queue: "imap" });
		const first = collect();
		setLogger(first.log);
		child.warn("before swap");
		logger.warn({ shared: true }, "shared");

		const second = collect();
		setLogger(second.log);
		child.warn("after swap");

		assert.deepEqual(
			first.lines.map((line) => [line.msg, line.queue, line.shared]),
			[
				["before swap", "imap", undefined],
				["shared", undefined, true],
			],
		);
		assert.deepEqual(
			second.lines.map((line) => [line.msg, line.queue]),
			[["after swap", "imap"]],
		);
	});

	it("carries a log context scope onto the installed logger's lines", async () => {
		const { lines, log } = collect();
		setLogger(log);
		await withLogContext({ requestId: "r1" }, async () => {
			await Promise.resolve();
			logger.warn("inside");
		});
		logger.warn("outside");
		assert.deepEqual(
			lines.map((line) => [line.msg, line.requestId]),
			[
				["inside", "r1"],
				["outside", undefined],
			],
		);
	});

	it("keeps setBindings on one handle off another", () => {
		const { lines, log } = collect();
		setLogger(log);
		const first = createLogger();
		first.setBindings({ owner: "first" });
		createLogger().warn("independent");
		first.warn("bound");
		assert.deepEqual(
			lines.map((line) => line.owner),
			[undefined, "first"],
		);
	});

	it("can be silenced by installing the noop logger", () => {
		setLogger(noopLogger);
		assert.doesNotThrow(() => logger.fatal("nowhere"));
		assert.equal(noopLogger.child({ a: 1 }), noopLogger);
	});
});
