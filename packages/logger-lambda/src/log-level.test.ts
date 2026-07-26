import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.LOG_LEVEL = "verbose";
delete process.env.REMIT_SERVICE_NAME;

type Line = Record<string, unknown>;

const originalWrite = process.stdout.write.bind(process.stdout);
const written: string[] = [];
let capturing = true;

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

// Capturing starts before the import: an unusable LOG_LEVEL is reported while
// the module is evaluated, not on the first call.
const { createLogger } = await import("./logger.js");
capturing = false;

const startup = written
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
	return written
		.join("")
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Line);
};

describe("log level", () => {
	it("reports an unusable LOG_LEVEL instead of failing or ignoring it", () => {
		assert.equal(startup.length, 1);
		const [line] = startup;
		assert.equal(line.level, "warn");
		assert.match(String(line.msg), /LOG_LEVEL/);
		assert.equal(line.configured, "verbose");
		assert.match(String(line.expected), /trace/);
	});

	it("falls back to info, so debug and trace are dropped", () => {
		const log = createLogger();
		const lines = capture(() => {
			log.trace("dropped");
			log.debug("dropped");
			log.warn("kept");
		});
		assert.deepEqual(
			lines.map((line) => line.msg),
			["kept"],
		);
	});

	it("defaults the service name when none is stamped into the build", () => {
		const [line] = capture(() => createLogger().warn("unnamed"));
		assert.equal(line.service, "remit");
	});
});
