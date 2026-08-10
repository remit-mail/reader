import assert from "node:assert/strict";
import { test } from "node:test";
import {
	CI_SUITE_LIMIT,
	LOCAL_SUITE_CONCURRENCY,
	LOCAL_TEST_CONCURRENCY,
	nodeTestArgs,
	nodeTestFlags,
	suiteConcurrency,
	testConcurrency,
} from "./test-bounds.mjs";

test("CI keeps the suite concurrency it had before the local bound existed", () => {
	assert.equal(suiteConcurrency({ CI: "true" }, 6), CI_SUITE_LIMIT);
	assert.equal(suiteConcurrency({ CI: "true" }, 2), 2);
	assert.equal(suiteConcurrency({ CI: "true" }, 0), 1);
});

test("CI adds no argument to the node --test command line", () => {
	assert.equal(testConcurrency({ CI: "true" }), null);
	assert.deepEqual(nodeTestArgs({ CI: "true" }), []);
	assert.equal(nodeTestFlags({ CI: "true" }), "");
});

test("a developer machine is bounded at both levels", () => {
	assert.equal(suiteConcurrency({}, 6), LOCAL_SUITE_CONCURRENCY);
	assert.equal(testConcurrency({}), LOCAL_TEST_CONCURRENCY);
	assert.deepEqual(nodeTestArgs({}), [
		`--test-concurrency=${LOCAL_TEST_CONCURRENCY}`,
	]);
});

test("the local bound is below the unbounded default it replaces", () => {
	assert.ok(LOCAL_SUITE_CONCURRENCY < CI_SUITE_LIMIT);
	assert.ok(LOCAL_TEST_CONCURRENCY < 6 - 1);
});

test("each level has its own override, usable on CI too", () => {
	assert.equal(suiteConcurrency({ TEST_CONCURRENCY: "6" }, 6), 6);
	assert.equal(suiteConcurrency({ CI: "true", TEST_CONCURRENCY: "1" }, 6), 1);
	assert.equal(testConcurrency({ NODE_TEST_CONCURRENCY: "6" }), 6);
	assert.deepEqual(nodeTestArgs({ CI: "true", NODE_TEST_CONCURRENCY: "1" }), [
		"--test-concurrency=1",
	]);
});

test("an override that is not a number falls through to the default", () => {
	assert.equal(suiteConcurrency({ TEST_CONCURRENCY: "" }, 6), 2);
	assert.equal(suiteConcurrency({ TEST_CONCURRENCY: "all" }, 6), 2);
	assert.equal(
		testConcurrency({ CI: "true", NODE_TEST_CONCURRENCY: "" }),
		null,
	);
});

test("an override below one is clamped rather than disabling the runner", () => {
	assert.equal(suiteConcurrency({ TEST_CONCURRENCY: "0" }, 6), 1);
	assert.equal(suiteConcurrency({ TEST_CONCURRENCY: "-4" }, 6), 1);
	assert.equal(testConcurrency({ NODE_TEST_CONCURRENCY: "0" }), 1);
});
