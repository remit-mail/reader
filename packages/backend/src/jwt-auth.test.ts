import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { APIGatewayProxyEvent } from "aws-lambda";
import {
	_setVerifierForTest,
	authenticateSelfHostRequest,
} from "./jwt-auth.js";
import { runWithRequestContext } from "./request-context.js";

const buildEvent = (
	overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent =>
	({
		headers: {},
		requestContext: {},
		...overrides,
	}) as APIGatewayProxyEvent;

let savedBypass: string | undefined;

beforeEach(() => {
	savedBypass = process.env.LOCAL_ACCOUNT_CONFIG_ID;
	delete process.env.LOCAL_ACCOUNT_CONFIG_ID;
});

afterEach(() => {
	_setVerifierForTest(null);
	if (savedBypass === undefined) delete process.env.LOCAL_ACCOUNT_CONFIG_ID;
	else process.env.LOCAL_ACCOUNT_CONFIG_ID = savedBypass;
});

test("valid token injects verified sub into authorizer claims", async () => {
	_setVerifierForTest(async () => ({ sub: "user-abc", email: "a@b.com" }));
	const event = buildEvent({
		headers: { Authorization: "Bearer good.token.here" },
	});

	const result = await authenticateSelfHostRequest(event);

	assert.equal(result, null);
	assert.equal(event.requestContext.authorizer?.claims?.sub, "user-abc");
	assert.equal(event.requestContext.authorizer?.claims?.email, "a@b.com");
});

test("invalid token returns 401 with correlation id and CORS headers", async () => {
	_setVerifierForTest(async () => {
		throw new Error("bad signature");
	});
	const event = buildEvent({
		headers: { authorization: "Bearer bad.token" },
	});

	const result = await runWithRequestContext(
		{ correlationId: "req-invalid-token" },
		async () => authenticateSelfHostRequest(event),
	);

	assert.equal(result?.statusCode, 401);
	assert.equal(
		result?.headers?.["x-correlation-id"],
		"req-invalid-token",
		"edge-auth 401 must carry the correlation id",
	);
	assert.equal(
		result?.headers?.["Access-Control-Allow-Origin"],
		"*",
		"edge-auth 401 must carry CORS headers",
	);
	assert.equal(
		result?.body,
		JSON.stringify({
			code: "unauthorized",
			message: "Invalid or expired token",
		}),
	);
	assert.equal(event.requestContext.authorizer, undefined);
});

test("no token with a local bypass configured is allowed", async () => {
	process.env.LOCAL_ACCOUNT_CONFIG_ID = "some-config-id";
	const event = buildEvent();

	const result = await authenticateSelfHostRequest(event);

	assert.equal(result, null);
});

test("no token and no bypass returns 401 with correlation id", async () => {
	const event = buildEvent();

	const result = await runWithRequestContext(
		{ correlationId: "req-no-token" },
		async () => authenticateSelfHostRequest(event),
	);

	assert.equal(result?.statusCode, 401);
	assert.equal(
		result?.headers?.["x-correlation-id"],
		"req-no-token",
		"edge-auth 401 must carry the correlation id",
	);
	assert.equal(
		result?.headers?.["Access-Control-Allow-Origin"],
		"*",
		"edge-auth 401 must carry CORS headers",
	);
});

test("a tokenless GET to the Microsoft OAuth callback is admitted", async () => {
	const event = buildEvent({
		httpMethod: "GET",
		path: "/accounts/oauth/microsoft/callback",
	});

	const result = await authenticateSelfHostRequest(event);

	assert.equal(result, null);
	assert.equal(event.requestContext.authorizer, undefined);
});

test("the callback exemption covers that path and method only", async () => {
	const neighbour = buildEvent({
		httpMethod: "GET",
		path: "/accounts/oauth/microsoft/start",
	});
	const otherMethod = buildEvent({
		httpMethod: "POST",
		path: "/accounts/oauth/microsoft/callback",
	});

	assert.equal((await authenticateSelfHostRequest(neighbour))?.statusCode, 401);
	assert.equal(
		(await authenticateSelfHostRequest(otherMethod))?.statusCode,
		401,
	);
});

test("pre-injected claims (edge tier) short-circuit verification", async () => {
	_setVerifierForTest(async () => {
		throw new Error("verifier must not be called");
	});
	const event = buildEvent({
		requestContext: {
			authorizer: { claims: { sub: "edge-user" } },
		} as unknown as APIGatewayProxyEvent["requestContext"],
	});

	const result = await authenticateSelfHostRequest(event);

	assert.equal(result, null);
	assert.equal(event.requestContext.authorizer?.claims?.sub, "edge-user");
});
