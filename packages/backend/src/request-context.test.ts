import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	getRequestOrigin,
	resolveAllowedOrigin,
	runWithRequestContext,
} from "./request-context.js";

describe("request-context", () => {
	const originalEnv = process.env.CORS_ALLOWED_ORIGINS;

	afterEach(() => {
		if (originalEnv === undefined) {
			process.env.CORS_ALLOWED_ORIGINS = undefined;
			process.env.CORS_ALLOWED_ORIGINS = "";
			delete process.env.CORS_ALLOWED_ORIGINS;
		} else {
			process.env.CORS_ALLOWED_ORIGINS = originalEnv;
		}
	});

	it("stores and retrieves the request origin", () => {
		runWithRequestContext({ origin: "https://example.com" }, () => {
			assert.equal(getRequestOrigin(), "https://example.com");
		});
	});

	it("returns undefined when no origin is set", () => {
		runWithRequestContext({}, () => {
			assert.equal(getRequestOrigin(), undefined);
		});
	});

	it("returns star when no allow-list is configured", () => {
		delete process.env.CORS_ALLOWED_ORIGINS;
		assert.equal(resolveAllowedOrigin("https://any.com"), "*");
	});

	it("reflects the request origin when it is allow-listed", () => {
		process.env.CORS_ALLOWED_ORIGINS =
			"https://app.example.com,http://localhost:5173";
		assert.equal(
			resolveAllowedOrigin("http://localhost:5173"),
			"http://localhost:5173",
		);
	});

	it("falls back to the first allowed origin when the request origin is not allow-listed", () => {
		process.env.CORS_ALLOWED_ORIGINS =
			"https://app.example.com,http://localhost:5173";
		assert.equal(
			resolveAllowedOrigin("https://evil.example.com"),
			"https://app.example.com",
		);
	});

	it("falls back to the first allowed origin when no request origin is provided", () => {
		process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
		assert.equal(resolveAllowedOrigin(undefined), "https://app.example.com");
	});
});
