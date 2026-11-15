import assert from "node:assert/strict";
import { test } from "node:test";
import { assignShards } from "./e2e-shards.mjs";

test("every spec lands in exactly one shard", () => {
	const specs = ["a", "b", "c", "d", "e", "f", "g"];
	const shards = assignShards(specs, { a: 5, b: 3, c: 8 }, 3);
	assert.deepEqual(shards.flatMap((shard) => shard.specs).sort(), specs);
});

test("shards balance by duration, not by count", () => {
	const shards = assignShards(
		["long", "s1", "s2", "s3", "s4"],
		{ long: 40, s1: 10, s2: 10, s3: 10, s4: 10 },
		2,
	);
	assert.deepEqual(
		shards.map((shard) => [shard.seconds, shard.specs]),
		[
			[40, ["long"]],
			[40, ["s1", "s2", "s3", "s4"]],
		],
	);
});

test("an unmeasured spec weighs the median of the measured ones", () => {
	const shards = assignShards(["new", "a", "b", "c"], { a: 1, b: 6, c: 9 }, 4);
	assert.equal(shards.find((shard) => shard.specs.includes("new")).seconds, 6);
});
