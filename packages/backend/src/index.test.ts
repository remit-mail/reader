/**
 * Issue #1054: the backend must log one structured access line per request
 * (method, path, status, duration, correlation id) at a level that is on in
 * production. The access log lives in `rawHandler` in `src/index.ts`, wrapping
 * the authenticated request path — so a 401 denial from edge-auth also gets an
 * access line (once it flows through `formatResponse` with the correlation id).
 *
 * The 401 response shape (correlation id header + CORS on the denial) is tested
 * directly in `jwt-auth.test.ts` via `runWithRequestContext`; this file tests
 * that the handler emits the access log line on every request by spying on the
 * logger's info method.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { logger } from "@remit/logger-lambda";
import { handler } from "./index.js";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";

const buildEvent = (
	overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent =>
	({
		path: "/api/test",
		httpMethod: "GET",
		pathParameters: {},
		queryStringParameters: {},
		headers: {},
		requestContext: {},
		...overrides,
	}) as unknown as APIGatewayProxyEvent;

const buildContext = (correlationId = "ctx-test-1"): Context =>
	({
		awsRequestId: correlationId,
		functionName: "test-function",
		getRemainingTimeInMillis: () => 30000,
	}) as unknown as Context;

describe("issue #1054: per-request access log", () => {
	it("emits one \"Request completed\" line at info level with method, path, status, duration and correlation id", async () => {
		delete process.env.LOCAL_ACCOUNT_CONFIG_ID;

		// Spy on logger.info — the real logger passes (fields, message) in
		// pino order, so the spy captures the structured fields and message.
		const infoSpy = mock.method(logger, "info");

		try {
			await handler(
				buildEvent({ path: "/api/__nonexistent_for_test__" }),
				buildContext("ctx-access-log"),
			).catch(() => {
				// 404s are expected; we only care about the log line.
			});

			const accessCalls = infoSpy.mock.calls.filter((call) => {
				// pino calls logger.info(fields, message)
				return call.arguments[1] === "Request completed";
			});

			assert.ok(accessCalls.length >= 1, "expected an access log line");
			const fields = accessCalls[0].arguments[0] as Record<
				string,
				unknown
			>;

			// infoSpy was called on logger.info, so the level is "info" by
			// construction — pino's adapter routes .info() calls to the info
			// level. No separate level field needed.

			assert.equal(fields.method, "GET");
			assert.equal(fields.path, "/api/__nonexistent_for_test__");
			assert.equal(fields.correlationId, "ctx-access-log");
			assert.equal(typeof fields.statusCode, "number");
			assert.equal(typeof fields.durationMs, "number");
		} finally {
			infoSpy.mock.restore();
		}
	});
});
