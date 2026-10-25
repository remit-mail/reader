import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Context as OpenAPIContext } from "openapi-backend";
import { testApiConfig } from "./config/test-config.js";
import {
	envelopeHeaders,
	postResponseHandler,
	resolveAllowedOrigin,
} from "./response.js";

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
	const logging = { config: testApiConfig({ responseValidation: "Log" }) };
	const skipping = { config: testApiConfig({ responseValidation: "Skip" }) };

	it("runs validateResponse when response validation logs", () => {
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		const result = postResponseHandler(
			makeContext({ items: [] }, validate),
			logging,
		);
		assert.equal(called, true);
		assert.equal(result.statusCode, 200);
	});

	it("skips validateResponse when response validation is skipped", () => {
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		const result = postResponseHandler(
			makeContext({ items: [] }, validate),
			skipping,
		);
		assert.equal(called, false);
		assert.equal(result.statusCode, 200);
	});

	it("returns the formatted error response when statusCode is set, regardless of mode", () => {
		let called = false;
		const validate: ValidateResponseFn = () => {
			called = true;
			return { valid: true };
		};
		const result = postResponseHandler(
			makeContext({ statusCode: 404, message: "Not Found" }, validate),
			logging,
		);
		assert.equal(called, false);
		assert.equal(result.statusCode, 404);
	});

	it("returns 200 with the response body when validation fails while logging", () => {
		const validate: ValidateResponseFn = () => ({
			valid: false,
			errors: [{ instancePath: "/items/0/id", message: "must be string" }],
		});
		const result = postResponseHandler(
			makeContext({ items: [{ id: 42 }] }, validate),
			logging,
		);
		assert.equal(result.statusCode, 200);
	});
});

// A bug report quotes the correlation id off the failing response. Without the
// header it reads "(none)" and there is nothing to grep the server logs for.
describe("the envelope every response carries", () => {
	const allowed = ["https://app.example.com", "http://localhost:5173"];

	it("carries the request's id, and exposes the header to the browser", () => {
		const headers = envelopeHeaders({
			origin: undefined,
			allowedOrigins: [],
			correlationId: "req-604",
		});

		assert.equal(headers["x-correlation-id"], "req-604");
		assert.match(
			String(headers["Access-Control-Expose-Headers"]),
			/x-correlation-id/,
		);
	});

	it("grants any origin when no allow-list is configured", () => {
		assert.equal(resolveAllowedOrigin("https://any.com", []), "*");
	});

	it("reflects the request origin when it is allow-listed", () => {
		assert.equal(
			resolveAllowedOrigin("http://localhost:5173", allowed),
			"http://localhost:5173",
		);
	});

	it("falls back to the first allowed origin otherwise", () => {
		assert.equal(
			resolveAllowedOrigin("https://evil.example.com", allowed),
			"https://app.example.com",
		);
		assert.equal(
			resolveAllowedOrigin(undefined, allowed),
			"https://app.example.com",
		);
	});
});
