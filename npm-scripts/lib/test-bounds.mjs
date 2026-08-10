import { availableParallelism } from "node:os";

export const CI_SUITE_LIMIT = 4;
export const LOCAL_SUITE_CONCURRENCY = 2;
export const LOCAL_TEST_CONCURRENCY = 2;

export const SUITE_CONCURRENCY_VAR = "TEST_CONCURRENCY";
export const TEST_CONCURRENCY_VAR = "NODE_TEST_CONCURRENCY";
export const NODE_TEST_FLAGS_VAR = "NODE_TEST_FLAGS";

function requested(value) {
	const parsed = Number.parseInt(value ?? "", 10);
	if (Number.isNaN(parsed)) return null;
	return Math.max(1, parsed);
}

export function suiteConcurrency(
	env = process.env,
	parallelism = availableParallelism(),
) {
	const override = requested(env[SUITE_CONCURRENCY_VAR]);
	if (override !== null) return override;
	if (env.CI) return Math.max(1, Math.min(parallelism, CI_SUITE_LIMIT));
	return LOCAL_SUITE_CONCURRENCY;
}

export function testConcurrency(env = process.env) {
	const override = requested(env[TEST_CONCURRENCY_VAR]);
	if (override !== null) return override;
	if (env.CI) return null;
	return LOCAL_TEST_CONCURRENCY;
}

// node rejects --test-concurrency in NODE_OPTIONS and in the config file, and
// ignores it once a test-file argument has been seen. It can only travel as a
// leading argument on the command line that already exists, which is why the
// workspace scripts expand NODE_TEST_FLAGS instead of reading a variable.
export function nodeTestArgs(env = process.env) {
	const concurrency = testConcurrency(env);
	if (concurrency === null) return [];
	return [`--test-concurrency=${concurrency}`];
}

export function nodeTestFlags(env = process.env) {
	return nodeTestArgs(env).join(" ");
}
