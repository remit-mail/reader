import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { attemptBudget } from "./attempt-budget.js";

describe("attemptBudget", () => {
	afterEach(() => {
		delete process.env.EXAMPLE_MAX_ATTEMPTS;
	});

	it("parses the named env var as a base-10 integer", () => {
		assert.equal(
			attemptBudget("EXAMPLE_MAX_ATTEMPTS", 3, {
				EXAMPLE_MAX_ATTEMPTS: "5",
			}),
			5,
		);
		assert.equal(
			attemptBudget("EXAMPLE_MAX_ATTEMPTS", 3, {
				EXAMPLE_MAX_ATTEMPTS: "10",
			}),
			10,
		);
	});

	it("reads only the named var, so budgets stay independent", () => {
		assert.equal(
			attemptBudget("EXAMPLE_MAX_ATTEMPTS", 3, {
				OTHER_MAX_ATTEMPTS: "9",
			}),
			3,
		);
	});

	it("falls back when the var is absent or empty", () => {
		assert.equal(attemptBudget("EXAMPLE_MAX_ATTEMPTS", 3, {}), 3);
		assert.equal(
			attemptBudget("EXAMPLE_MAX_ATTEMPTS", 7, { EXAMPLE_MAX_ATTEMPTS: "" }),
			7,
		);
	});

	it("falls back on a value that is not a positive integer", () => {
		for (const raw of ["nope", "0", "-1", "NaN", " "]) {
			assert.equal(
				attemptBudget("EXAMPLE_MAX_ATTEMPTS", 3, {
					EXAMPLE_MAX_ATTEMPTS: raw,
				}),
				3,
				`expected ${JSON.stringify(raw)} to fall back`,
			);
		}
	});

	it("reads process.env when no environment is supplied", () => {
		process.env.EXAMPLE_MAX_ATTEMPTS = "4";
		assert.equal(attemptBudget("EXAMPLE_MAX_ATTEMPTS", 3), 4);
	});
});
