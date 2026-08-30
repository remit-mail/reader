import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMemAvailableBytes } from "./memory.js";

const MEMINFO = [
	"MemTotal:        3908340 kB",
	"MemFree:          131072 kB",
	"MemAvailable:     786432 kB",
	"Buffers:            1024 kB",
].join("\n");

describe("reading what the box has left", () => {
	it("reads MemAvailable, in bytes", () => {
		assert.equal(parseMemAvailableBytes(MEMINFO), 786432 * 1024);
	});

	// MemFree on a box with a warm page cache reads near zero, which would stall
	// the worker permanently; picking the wrong line must fail, not approximate.
	it("does not settle for MemFree", () => {
		const withoutAvailable = MEMINFO.split("\n")
			.filter((line) => !line.startsWith("MemAvailable:"))
			.join("\n");
		assert.throws(
			() => parseMemAvailableBytes(withoutAvailable),
			/MemAvailable/,
		);
	});
});
