import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import type {
	AccountResponse,
	AccountService as AccountServiceName,
} from "@remit/api-openapi-types";
import { AccountService } from "@remit/domain-enums";
import { MICROSOFT_SERVICE_SCOPES } from "@remit/mail-oauth-service";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { deriveAccountConfigId } from "../auth.js";
import {
	_resetForTest,
	type RemitClient,
	setClient,
} from "../service/data-client.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";

const CLIENT_SECRET = "consent-test-client-secret";
const WEB_ORIGIN = "https://mail.example.com";
const GRAPH = "https://graph.microsoft.com/";
const MAIL_SCOPES = [...MICROSOFT_SERVICE_SCOPES[AccountService.Mail]];
const CALENDAR_SCOPES = [...MICROSOFT_SERVICE_SCOPES[AccountService.Calendar]];

let handler: (
	event: APIGatewayProxyEvent,
	context: unknown,
) => Promise<APIGatewayProxyResult>;
let client: RemitClient;
let cleanup: () => void;
let tokenEndpoint: Server;
let withheld: Set<string>;
let redemptions: string[][];

const jwt = (claims: Record<string, unknown>): string =>
	[
		Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"),
		Buffer.from(JSON.stringify(claims), "utf8").toString("base64url"),
		"signature-not-checked-here",
	].join(".");

const readBody = async (request: AsyncIterable<Buffer>): Promise<string> => {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
};

const startTokenEndpoint = async (): Promise<string> => {
	tokenEndpoint = createServer(async (request, response) => {
		const form = new URLSearchParams(await readBody(request));
		const requested = (form.get("scope") ?? "").split(" ").filter(Boolean);
		redemptions.push(requested);
		const granted = requested.filter((scope) => !withheld.has(scope));
		const resourceScopes = granted.filter((scope) => scope.includes("://"));
		if (resourceScopes.length === 0) {
			response.writeHead(400, { "Content-Type": "application/json" });
			response.end(
				JSON.stringify({ error: "invalid_grant", error_codes: [65001] }),
			);
			return;
		}
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(
			JSON.stringify({
				access_token: "access-token",
				refresh_token: `refresh-token-${redemptions.length}`,
				id_token: jwt({ preferred_username: "person@example.com" }),
				expires_in: 3600,
				scope: granted
					.map((scope) =>
						scope.startsWith(GRAPH) ? scope.slice(GRAPH.length) : scope,
					)
					.join(" "),
			}),
		);
	});
	await new Promise<void>((resolve) => tokenEndpoint.listen(0, resolve));
	const { port } = tokenEndpoint.address() as AddressInfo;
	return `http://127.0.0.1:${port}/token`;
};

const headerOf = (
	response: APIGatewayProxyResult,
	name: string,
): string | undefined => {
	for (const [key, value] of Object.entries(response.headers ?? {})) {
		if (key.toLowerCase() === name) return String(value);
	}
	return undefined;
};

const request = (
	sub: string,
	httpMethod: string,
	path: string,
	body: unknown,
	queryStringParameters: Record<string, string> | null = null,
): Promise<APIGatewayProxyResult> =>
	handler(
		{
			httpMethod,
			path,
			headers: { "content-type": "application/json" },
			queryStringParameters,
			body: body === null ? null : JSON.stringify(body),
			requestContext: { authorizer: { claims: { sub } } },
		} as unknown as APIGatewayProxyEvent,
		{ awsRequestId: `req-${randomUUID()}`, functionName: "test" },
	);

const startConsent = async (
	sub: string,
	services: AccountServiceName[] | undefined,
): Promise<URL> => {
	const response = await request(
		sub,
		"POST",
		"/accounts/oauth/microsoft/start",
		{
			email: "person@example.com",
			services,
		},
	);
	assert.equal(response.statusCode, 200, response.body);
	return new URL(
		(JSON.parse(response.body) as { authorizationUrl: string })
			.authorizationUrl,
	);
};

const consent = async (
	sub: string,
	services: AccountServiceName[] | undefined,
): Promise<string> => {
	const authorizationUrl = await startConsent(sub, services);
	const state = authorizationUrl.searchParams.get("state");
	assert.ok(state, "the authorization URL carries the signed state");
	const response = await request(
		sub,
		"GET",
		"/accounts/oauth/microsoft/callback",
		null,
		{ code: "auth-code", state },
	);
	assert.equal(response.statusCode, 302, response.body);
	const location = headerOf(response, "location");
	assert.ok(location, "the callback answers with a Location");
	return location;
};

const onlyAccount = async (sub: string) => {
	const accounts = await client.account.listAllByAccountConfig(
		deriveAccountConfigId(sub),
	);
	assert.equal(accounts.length, 1, "the consent wrote exactly one account");
	return accounts[0];
};

const patchServices = (
	sub: string,
	accountId: string,
	syncedServices: AccountServiceName[],
): Promise<APIGatewayProxyResult> =>
	request(sub, "PATCH", `/accounts/${accountId}`, { syncedServices });

before(async () => {
	_resetForTest();
	process.env.DATA_BACKEND = "sqlite";
	process.env.CORS_ALLOWED_ORIGINS = WEB_ORIGIN;
	process.env.MSOAUTH_REDIRECT_URI = `${WEB_ORIGIN}/accounts/oauth/microsoft/callback`;
	process.env.MSOAUTH_CLIENT_ID = "consent-test-client-id";
	process.env.MSOAUTH_CLIENT_SECRET = CLIENT_SECRET;
	process.env.MSOAUTH_TOKEN_ENDPOINT = await startTokenEndpoint();
	process.env.FAKE_KMS_DATAKEY = "0".repeat(64);
	process.env.AWS_REGION = "eu-west-1";
	process.env.AWS_ACCESS_KEY_ID = "test";
	process.env.AWS_SECRET_ACCESS_KEY = "test";
	({ client, cleanup } = await createCalendarSqliteClient());
	setClient(client);
	({ handler } = (await import("../index.js")) as unknown as {
		handler: typeof handler;
	});
});

beforeEach(() => {
	withheld = new Set();
	redemptions = [];
});

after(async () => {
	_resetForTest();
	cleanup();
	await new Promise<void>((resolve) => tokenEndpoint.close(() => resolve()));
});

describe("the Microsoft consent for the services an account syncs", () => {
	it("asks for the calendar scope only when the start names Calendar", async () => {
		const sub = randomUUID();

		const mailOnly = (
			await startConsent(sub, [AccountService.Mail])
		).searchParams
			.get("scope")
			?.split(" ");
		const calendarOnly = (
			await startConsent(sub, [AccountService.Calendar])
		).searchParams
			.get("scope")
			?.split(" ");

		assert.ok(mailOnly);
		assert.ok(calendarOnly);
		assert.deepEqual(
			mailOnly.filter((scope) => scope.includes("://")),
			MAIL_SCOPES,
		);
		assert.deepEqual(
			calendarOnly.filter((scope) => scope.includes("://")),
			CALENDAR_SCOPES,
		);
		assert.ok(calendarOnly.includes("offline_access"));
	});

	it("creates a calendar-only account holding the calendar grant", async () => {
		const sub = randomUUID();

		const location = await consent(sub, [AccountService.Calendar]);

		const account = await onlyAccount(sub);
		assert.equal(
			location,
			`${WEB_ORIGIN}/settings/accounts?connected=${encodeURIComponent(account.accountId)}`,
		);
		assert.deepEqual(account.syncedServices, [AccountService.Calendar]);
		assert.deepEqual(account.grantedScopes, CALENDAR_SCOPES);
		assert.deepEqual(redemptions, [
			[...CALENDAR_SCOPES, "offline_access", "openid", "email"],
		]);
	});

	it("refuses a consent that comes back without the calendar scope and writes nothing", async () => {
		const sub = randomUUID();
		withheld = new Set(CALENDAR_SCOPES);

		const location = await consent(sub, [
			AccountService.Mail,
			AccountService.Calendar,
		]);

		assert.equal(
			location,
			`${WEB_ORIGIN}/settings/accounts?oauthError=scope_not_granted&oauthEmail=person%40example.com&missingServices=Calendar`,
		);
		assert.deepEqual(
			await client.account.listAllByAccountConfig(deriveAccountConfigId(sub)),
			[],
		);
	});

	it("keeps calendar when a mail and calendar account reconnects naming only its email", async () => {
		const sub = randomUUID();
		await consent(sub, [AccountService.Mail, AccountService.Calendar]);
		const connected = await onlyAccount(sub);

		redemptions = [];
		const location = await consent(sub, undefined);

		const reconnected = await onlyAccount(sub);
		assert.equal(
			location,
			`${WEB_ORIGIN}/settings/accounts?connected=${encodeURIComponent(connected.accountId)}`,
		);
		assert.deepEqual(reconnected.syncedServices, [
			AccountService.Mail,
			AccountService.Calendar,
		]);
		assert.deepEqual(reconnected.grantedScopes, [
			...MAIL_SCOPES,
			...CALENDAR_SCOPES,
		]);
		assert.deepEqual(
			redemptions.map((scopes) => scopes.filter((s) => s.includes("://"))),
			[MAIL_SCOPES, CALENDAR_SCOPES],
		);
	});

	it("adds calendar to a mail account through a second consent", async () => {
		const sub = randomUUID();
		await consent(sub, [AccountService.Mail]);
		const mailAccount = await onlyAccount(sub);
		assert.deepEqual(mailAccount.grantedScopes, MAIL_SCOPES);

		const refused = await patchServices(sub, mailAccount.accountId, [
			AccountService.Mail,
			AccountService.Calendar,
		]);
		assert.equal(refused.statusCode, 400, refused.body);
		const { message } = JSON.parse(refused.body) as { message: string };
		assert.match(message, /granted scopes lack Calendar/);
		assert.match(message, /POST \/accounts\/oauth\/microsoft\/start/);

		redemptions = [];
		await consent(sub, [AccountService.Mail, AccountService.Calendar]);

		const reconnected = await onlyAccount(sub);
		assert.equal(reconnected.accountId, mailAccount.accountId);
		assert.deepEqual(reconnected.syncedServices, [
			AccountService.Mail,
			AccountService.Calendar,
		]);
		assert.deepEqual(reconnected.grantedScopes, [
			...MAIL_SCOPES,
			...CALENDAR_SCOPES,
		]);
		assert.deepEqual(
			redemptions.map((scopes) => scopes.filter((s) => s.includes("://"))),
			[MAIL_SCOPES, CALENDAR_SCOPES],
		);

		const mailAgain = await patchServices(sub, mailAccount.accountId, [
			AccountService.Mail,
		]);
		assert.equal(mailAgain.statusCode, 200, mailAgain.body);
		const both = await patchServices(sub, mailAccount.accountId, [
			AccountService.Calendar,
			AccountService.Mail,
		]);
		assert.equal(both.statusCode, 200, both.body);
		assert.deepEqual(
			(JSON.parse(both.body) as AccountResponse).syncedServices,
			[AccountService.Mail, AccountService.Calendar],
		);
	});
});
