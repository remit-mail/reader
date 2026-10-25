import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { lambdaHandler } from "./api-fixture.js";
import { testApiConfig } from "./config/test-config.js";
import {
	_setVerifierForTest,
	identityFromSelfHostRequest,
} from "./jwt-auth.js";
import type { HandlerIdentity } from "./types.js";

const buildEvent = (
	overrides: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent =>
	({
		headers: {},
		requestContext: {},
		...overrides,
	}) as APIGatewayProxyEvent;

const NO_BYPASS: HandlerIdentity = { kind: "anonymous" };

afterEach(() => {
	_setVerifierForTest(null);
});

test("a valid token is the caller it names", async () => {
	_setVerifierForTest(async () => ({ sub: "user-abc", email: "a@b.com" }));
	const event = buildEvent({
		headers: { Authorization: "Bearer good.token.here" },
	});

	assert.deepEqual(await identityFromSelfHostRequest(event, NO_BYPASS), {
		kind: "user",
		accountConfigId: deriveAccountConfigId("user-abc"),
		sub: "user-abc",
		email: "a@b.com",
	});
});

test("an invalid token is an anonymous caller", async () => {
	_setVerifierForTest(async () => {
		throw new Error("bad signature");
	});
	const event = buildEvent({ headers: { authorization: "Bearer bad.token" } });

	assert.deepEqual(await identityFromSelfHostRequest(event, NO_BYPASS), {
		kind: "anonymous",
	});
});

test("no token with a local bypass configured is the pinned user", async () => {
	const pinned: HandlerIdentity = {
		kind: "user",
		accountConfigId: "some-config-id",
		sub: "some-config-id",
		email: "dev@example.com",
	};

	assert.deepEqual(
		await identityFromSelfHostRequest(buildEvent(), pinned),
		pinned,
	);
});

test("no token and no bypass is an anonymous caller", async () => {
	assert.deepEqual(await identityFromSelfHostRequest(buildEvent(), NO_BYPASS), {
		kind: "anonymous",
	});
});

test("pre-injected claims (edge tier) short-circuit verification", async () => {
	_setVerifierForTest(async () => {
		throw new Error("verifier must not be called");
	});
	const event = buildEvent({
		requestContext: {
			authorizer: { claims: { sub: "edge-user", email: "e@b.com" } },
		} as unknown as APIGatewayProxyEvent["requestContext"],
	});

	const identity = await identityFromSelfHostRequest(event, NO_BYPASS);

	assert.equal(identity.kind === "user" && identity.sub, "edge-user");
});

test("a self-host request with an invalid token answers 401 with correlation id and CORS headers", async () => {
	_setVerifierForTest(async () => {
		throw new Error("bad signature");
	});
	const handler = lambdaHandler(
		async () => {
			throw new Error("a refused request must not build a client");
		},
		testApiConfig({
			auth: { mode: "BetterAuthJwt", contentSigningSecret: "s".repeat(32) },
		}),
	);

	const result = await handler(
		buildEvent({
			httpMethod: "GET",
			path: "/calendars",
			headers: { authorization: "Bearer bad.token" },
		}),
		{ awsRequestId: "req-invalid-token" } as Context,
	);

	assert.equal(result.statusCode, 401);
	assert.equal(result.headers?.["x-correlation-id"], "req-invalid-token");
	assert.equal(result.headers?.["Access-Control-Allow-Origin"], "*");
	assert.deepEqual(JSON.parse(result.body), {
		code: "unauthorized",
		message: "Unauthorized",
	});
});
