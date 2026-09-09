/**
 * The browser Microsoft sends back, and where it ends up.
 *
 * The callback answers a redirect, so the whole response is its Location
 * header: an answer that arrives without it is a blank page with the account
 * either connected or not and no way to tell. Driven through the real OpenAPI
 * document and the self-host request path, so what is asserted is what a
 * self-hosted deployment writes onto the wire — the header included, which a
 * handler returning a bare `{statusCode, headers}` shape lost on the way out.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { signState } from "./account-oauth.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";

const CLIENT_SECRET = "callback-test-client-secret";
const WEB_ORIGIN = "https://mail.example.com";
const CALLBACK_PATH = "/accounts/oauth/microsoft/callback";

let handler: (
	event: APIGatewayProxyEvent,
	context: unknown,
) => Promise<APIGatewayProxyResult>;
let client: RemitClient;
let cleanup: () => void;
let tokenEndpoint: Server;

const jwt = (claims: Record<string, unknown>): string =>
	[
		Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
		Buffer.from(JSON.stringify(claims), "utf8").toString("base64url"),
		"signature-not-checked-here",
	].join(".");

/** Microsoft's token endpoint, close enough for the one call the callback makes. */
const startTokenEndpoint = async (): Promise<string> => {
	tokenEndpoint = createServer((_request, response) => {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(
			JSON.stringify({
				access_token: "access-token",
				refresh_token: "refresh-token",
				id_token: jwt({ preferred_username: "matthijs@example.com" }),
				expires_in: 3600,
			}),
		);
	});
	await new Promise<void>((resolve) => tokenEndpoint.listen(0, resolve));
	const { port } = tokenEndpoint.address() as AddressInfo;
	return `http://127.0.0.1:${port}/token`;
};

const callback = (
	query: Record<string, string>,
): Promise<APIGatewayProxyResult> =>
	handler(
		{
			httpMethod: "GET",
			path: CALLBACK_PATH,
			headers: {},
			queryStringParameters: query,
			body: null,
			requestContext: {},
		} as unknown as APIGatewayProxyEvent,
		{ awsRequestId: `req-${randomUUID()}`, functionName: "test" },
	);

const headerOf = (
	response: APIGatewayProxyResult,
	name: string,
): string | undefined => {
	for (const [key, value] of Object.entries(response.headers ?? {})) {
		if (key.toLowerCase() === name) return String(value);
	}
	return undefined;
};

before(async () => {
	_resetForTest();
	process.env.DATA_BACKEND = "sqlite";
	process.env.CORS_ALLOWED_ORIGINS = WEB_ORIGIN;
	process.env.MSOAUTH_REDIRECT_URI = `${WEB_ORIGIN}${CALLBACK_PATH}`;
	process.env.MSOAUTH_CLIENT_ID = "callback-test-client-id";
	process.env.MSOAUTH_CLIENT_SECRET = CLIENT_SECRET;
	process.env.MSOAUTH_TOKEN_ENDPOINT = await startTokenEndpoint();
	// The self-host key that encrypts the stored refresh token.
	process.env.FAKE_KMS_DATAKEY = "0".repeat(64);
	// Static credentials so the best-effort sync enqueue fails against the local
	// queue instead of walking the instance-metadata chain for a minute.
	process.env.AWS_REGION = "eu-west-1";
	process.env.AWS_ACCESS_KEY_ID = "test";
	process.env.AWS_SECRET_ACCESS_KEY = "test";
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
	({ handler } = (await import("../index.js")) as unknown as {
		handler: typeof handler;
	});
});

after(async () => {
	_resetForTest();
	cleanup();
	await new Promise<void>((resolve) => tokenEndpoint.close(() => resolve()));
});

describe("the Microsoft OAuth callback", () => {
	it("sends the consenting browser on to the connected account", async () => {
		const accountConfigId = randomUUID();
		const state = await signState(
			{ accountConfigId, nonce: "nonce", timestamp: Date.now() },
			CLIENT_SECRET,
		);

		const response = await callback({ code: "auth-code", state });

		assert.equal(response.statusCode, 302, response.body);
		const location = headerOf(response, "location");
		assert.ok(location, "a redirect without a Location header is a blank page");
		const [connected] =
			await client.account.listAllByAccountConfig(accountConfigId);
		assert.ok(connected, "the callback stored the account it redirects to");
		assert.equal(
			location,
			`${WEB_ORIGIN}/settings/accounts?connected=${encodeURIComponent(connected.accountId)}`,
		);
	});

	it("sends a refused consent back with the reason Microsoft gave", async () => {
		const response = await callback({ error: "access_denied" });

		assert.equal(response.statusCode, 302, response.body);
		assert.equal(
			headerOf(response, "location"),
			`${WEB_ORIGIN}/settings/accounts?oauthError=access_denied`,
		);
	});
});
