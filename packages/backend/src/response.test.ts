import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { Context as OpenAPIContext } from "openapi-backend";
import { postResponseHandler } from "./response.js";

type ValidateResponseFn = (
	response: unknown,
	operation: unknown,
) => { valid: boolean; errors?: { instancePath?: string; message?: string }[] };

const makeContext = (
	response: Record<string, unknown>,
	validateResponse: ValidateResponseFn,
): OpenAPIContext => {
	return {
		api: { validateResponse },
		response,
		operation: { operationId: "testOp" },
	} as unknown as OpenAPIContext;
};

describe("postResponseHandler validation gating", () => {
	const originalStage = process.env.STAGE_NAME;

	beforeEach(() => {
		delete process.env.STAGE_NAME;
	});

	afterEach(() => {
		if (originalStage === undefined) {
			delete process.env.STAGE_NAME;
		} else {
			process.env.STAGE_NAME = originalStage;
		}
	});

	it("runs validateResponse when STAGE_NAME is 'dev'", () => {
		process.env.STAGE_NAME = "dev";
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		const result = postResponseHandler(makeContext({ items: [] }, validate));
		assert.equal(called, true);
		assert.equal(result.statusCode, 200);
	});

	it("skips validateResponse when STAGE_NAME is 'prod'", () => {
		process.env.STAGE_NAME = "prod";
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		const result = postResponseHandler(makeContext({ items: [] }, validate));
		assert.equal(called, false);
		assert.equal(result.statusCode, 200);
	});

	it("skips validateResponse when STAGE_NAME is 'beta'", () => {
		process.env.STAGE_NAME = "beta";
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		postResponseHandler(makeContext({ items: [] }, validate));
		assert.equal(called, false);
	});

	it("skips validateResponse when STAGE_NAME is unset", () => {
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		postResponseHandler(makeContext({ items: [] }, validate));
		assert.equal(called, false);
	});

	it("returns the formatted error response when statusCode is set, regardless of stage", () => {
		process.env.STAGE_NAME = "dev";
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		const result = postResponseHandler(
			makeContext({ statusCode: 404, message: "Not Found" }, validate),
		);
		assert.equal(called, false);
		assert.equal(result.statusCode, 404);
	});

	it("returns 200 with the response body when validation fails in dev", () => {
		process.env.STAGE_NAME = "dev";
		const validate: ValidateResponseFn = () => ({
			valid: false,
			errors: [{ instancePath: "/items/0/id", message: "must be string" }],
		});
		const result = postResponseHandler(
			makeContext({ items: [{ id: 42 }] }, validate),
		);
		assert.equal(result.statusCode, 200);
	});
});
