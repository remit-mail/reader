/**
 * The two refusals no handler ever sees: a path the spec does not route, and a
 * request the spec refuses before routing. Both are answered by the framework,
 * and both used to leave the one shape the API promises (issue #371) — the
 * unmatched route with no body at all, the refused request with no `code` and
 * with the validator's raw findings beside it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { api } from "./index.js";
import { normalizeRequest } from "./request.js";

const SUB = "cognito-sub-pipeline";

const send = async (
	method: string,
	path: string,
	body?: string,
): Promise<APIGatewayProxyResult> => {
	const event = {
		httpMethod: method,
		path,
		body: body ?? null,
		queryStringParameters: null,
		headers: body ? { "content-type": "application/json" } : {},
		requestContext: { authorizer: { claims: { sub: SUB } } },
	} as unknown as APIGatewayProxyEvent;

	return (await api.handleRequest(
		normalizeRequest(event),
		event,
		{} as never,
	)) as APIGatewayProxyResult;
};

describe("a path the spec does not route", () => {
	it("answers 404 with a body, not an empty one", async () => {
		const response = await send("GET", "/no-such-resource");

		assert.equal(response.statusCode, 404);
		assert.deepEqual(JSON.parse(response.body), {
			code: "not_found",
			message: "Not found",
		});
	});
});

describe("a request the spec refuses before any handler runs", () => {
	it("answers 400 with a code and the fields it refused", async () => {
		const response = await send(
			"POST",
			"/calendars",
			JSON.stringify({ displayName: 42 }),
		);

		assert.equal(response.statusCode, 400);
		const body = JSON.parse(response.body) as {
			code: string;
			message: string;
			errors: { path: string; rule: string; message: string }[];
		};

		assert.equal(body.code, "invalid_request");
		assert.equal(body.message, "Invalid request");
		assert.ok(body.errors.length > 0);
		for (const detail of body.errors) {
			assert.deepEqual(Object.keys(detail).sort(), ["message", "path", "rule"]);
			assert.equal(typeof detail.path, "string");
			assert.equal(typeof detail.rule, "string");
			assert.equal(typeof detail.message, "string");
		}
	});

	// An AJV error also carries `params`, and under `verbose` the rejected value
	// itself. A refused create body is whatever the caller sent — a password
	// among the possibilities — so nothing but the three named fields may travel.
	it("never echoes the value it refused", async () => {
		const response = await send(
			"POST",
			"/accounts",
			JSON.stringify({ password: "hunter2", imapPort: "not-a-number" }),
		);

		assert.equal(response.statusCode, 400);
		assert.ok(!response.body.includes("hunter2"));
	});
});
