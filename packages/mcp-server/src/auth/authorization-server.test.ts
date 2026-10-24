import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type Auth, createAuth } from "@remit/auth-service";
import {
	createJwtVerifier,
	resolveVerifierConfig,
} from "@remit/auth-service/verifier";
import { BodySyncService, SyncWarningService } from "@remit/mailbox-service";
import {
	openStore,
	type Store,
	silentLog,
} from "@remit/mailbox-service/test-helpers/test-store";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createLocalJWKSet, type JSONWebKeySet } from "jose";
import { createMcpApp, type McpAppHandler } from "../app.js";
import type { McpDeps } from "../deps.js";
import {
	createBetterAuthTokenVerifier,
	createMcpAuth,
	createMcpAuthRoutes,
	type McpAuth,
} from "./authorization-server.js";
import { type McpAuthDatabase, openMcpAuthDatabase } from "./database.js";

const MCP_ORIGIN = "https://mcp.remit.test";
const MAIN_ORIGIN = "https://reader.remit.test";
const RESOURCE = `${MCP_ORIGIN}/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const EMAIL = "owner@remit.test";
const PASSWORD = "correct horse battery staple";
const PEER = "203.0.113.7";
const PROXY = "10.0.0.2";

const MIGRATIONS = new URL(
	"../../../../deploy/vps/migrations-sqlite/",
	import.meta.url,
);

let dir: string;
let store: Store;
let filename: string;
let database: McpAuthDatabase;
let deps: McpDeps;
let mainAuth: Auth;
let auth: McpAuth;
let app: McpAppHandler;
let mainSessionToken: string;
let mainJwt: string;

const sharedRows = (): unknown[] => {
	const sqlite = new Database(filename, { readonly: true });
	const rows = [
		...sqlite.prepare("SELECT * FROM auth_user ORDER BY id").all(),
		...sqlite.prepare("SELECT * FROM auth_account ORDER BY id").all(),
	];
	sqlite.close();
	return rows;
};

const buildApp = (): { auth: McpAuth; app: McpAppHandler } => {
	const instance = createMcpAuth({
		origin: MCP_ORIGIN,
		secret: "mcp-instance-secret-0123456789abcdef",
		db: database.db,
	});
	return {
		auth: instance,
		app: createMcpApp({
			origin: MCP_ORIGIN,
			authRoutes: createMcpAuthRoutes(instance),
			verifier: createBetterAuthTokenVerifier(instance, MCP_ORIGIN),
			deps,
			trustedProxies: new Set([PROXY]),
		}),
	};
};

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "mcp-auth-"));
	filename = join(dir, "remit.db");
	const migrating = new Database(filename);
	migrating.pragma("journal_mode = WAL");
	migrating.pragma("foreign_keys = ON");
	for (const set of ["auth", "mcp"]) {
		migrate(drizzle(migrating), {
			migrationsFolder: fileURLToPath(new URL(set, MIGRATIONS)),
			migrationsTable: `__drizzle_migrations_${set}`,
		});
	}
	migrating.close();

	mainAuth = await createAuth({
		connectionString: filename,
		secret: "main-instance-secret-0123456789abcdef",
		baseURL: MAIN_ORIGIN,
		selfSignUpEnabled: true,
	});
	const signUp = await mainAuth.api.signUpEmail({
		body: { email: EMAIL, password: PASSWORD, name: "Owner" },
		asResponse: true,
	});
	assert.equal(signUp.status, 200);
	mainSessionToken = ((await signUp.json()) as { token: string }).token;
	const cookie = signUp.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	const minted = await mainAuth.handler(
		new Request(`${MAIN_ORIGIN}/api/auth/token`, { headers: { cookie } }),
	);
	assert.equal(minted.status, 200);
	mainJwt = ((await minted.json()) as { token: string }).token;

	store = await openStore();
	const storage = store.storage();
	database = openMcpAuthDatabase(filename);
	deps = {
		...store,
		storage,
		bodySync: new BodySyncService(
			store.message,
			storage,
			store.threadMessage,
			store.address,
			store.envelope,
			new SyncWarningService(store.syncWarning),
			silentLog,
		),
		bodySyncQueue: undefined,
		logger: silentLog,
	};
	({ auth, app } = buildApp());
});

after(async () => {
	database.close();
	await store.close();
	rmSync(dir, { recursive: true, force: true });
});

const call = (path: string, init: RequestInit = {}): Promise<Response> =>
	app(new Request(`${MCP_ORIGIN}${path}`, init), PEER);

const form = (
	path: string,
	fields: Record<string, string>,
	cookie = "",
): Promise<Response> =>
	call(path, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			origin: MCP_ORIGIN,
			cookie,
		},
		body: new URLSearchParams(fields),
	});

const cookiesOf = (response: Response): string =>
	response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");

const locationOf = (response: Response): URL => {
	assert.equal(
		response.status,
		302,
		`expected a redirect, got ${response.status}`,
	);
	const location = response.headers.get("location");
	assert.ok(location, "redirect without a location");
	return new URL(location, MCP_ORIGIN);
};

const register = async (redirectUris: string[]): Promise<Response> =>
	call("/auth/oauth2/register", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: "Claude",
			redirect_uris: redirectUris,
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		}),
	});

const registerClient = async (): Promise<string> => {
	const response = await register([CALLBACK]);
	assert.equal(response.status, 201, await response.clone().text());
	const { client_id } = (await response.json()) as { client_id: string };
	return client_id;
};

const pkce = (): { verifier: string; challenge: string } => {
	const verifier = randomBytes(32).toString("base64url");
	return {
		verifier,
		challenge: createHash("sha256").update(verifier).digest("base64url"),
	};
};

const authorizeUrl = (
	clientId: string,
	challenge: string,
	{ redirectUri = CALLBACK, withResource = true } = {},
): string =>
	`/auth/oauth2/authorize?${new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: "mail:read offline_access",
		state: "state-123",
		code_challenge: challenge,
		code_challenge_method: "S256",
		...(withResource ? { resource: RESOURCE } : {}),
	})}`;

const authorize = async (
	clientId: string,
	challenge: string,
	withResource = true,
): Promise<{ code: string; cookie: string }> => {
	const toLogin = locationOf(
		await call(authorizeUrl(clientId, challenge, { withResource })),
	);
	assert.equal(`${toLogin.origin}${toLogin.pathname}`, `${MCP_ORIGIN}/login`);
	assert.equal((await call(`/login${toLogin.search}`)).status, 200);

	const signedIn = await form("/login", {
		email: EMAIL,
		password: PASSWORD,
		oauth_query: toLogin.search.slice(1),
	});
	const cookie = cookiesOf(signedIn);
	const afterSignIn = locationOf(signedIn);
	const callback =
		afterSignIn.pathname === "/consent"
			? await consent(afterSignIn, cookie)
			: afterSignIn;
	assert.equal(`${callback.origin}${callback.pathname}`, CALLBACK);
	assert.equal(callback.searchParams.get("state"), "state-123");
	const code = callback.searchParams.get("code");
	assert.ok(code, "the callback carries no code");
	return { code, cookie };
};

const consent = async (toConsent: URL, cookie: string): Promise<URL> => {
	const consentPage = await call(`/consent${toConsent.search}`, {
		headers: { cookie },
	});
	assert.equal(consentPage.status, 200);
	assert.match(await consentPage.text(), /Claude/);

	return locationOf(
		await form(
			"/consent",
			{ accept: "true", oauth_query: toConsent.search.slice(1) },
			cookie,
		),
	);
};

type TokenResponse = {
	access_token?: string;
	refresh_token?: string;
	error?: string;
};

const token = async (
	fields: Record<string, string>,
	withResource = true,
): Promise<{ status: number; body: TokenResponse }> => {
	const response = await call("/auth/oauth2/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			...(withResource ? { resource: RESOURCE } : {}),
			...fields,
		}),
	});
	return {
		status: response.status,
		body: (await response.json()) as TokenResponse,
	};
};

const exchange = (
	clientId: string,
	code: string,
	verifier: string,
	withResource = true,
) =>
	token(
		{
			grant_type: "authorization_code",
			client_id: clientId,
			code,
			redirect_uri: CALLBACK,
			code_verifier: verifier,
		},
		withResource,
	);

const listTools = (bearer: string | undefined): Promise<Response> =>
	call("/mcp", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
	});

describe("the MCP authorization server", () => {
	let clientId: string;
	let accessToken: string;
	let refreshToken: string;
	let mcpSessionCookie: string;

	it("publishes the authorization server metadata at the MCP origin", async () => {
		const response = await call("/.well-known/oauth-authorization-server");
		assert.equal(response.status, 200);
		const metadata = (await response.json()) as Record<string, unknown>;
		assert.equal(metadata.issuer, MCP_ORIGIN);
		assert.equal(
			metadata.registration_endpoint,
			`${MCP_ORIGIN}/auth/oauth2/register`,
		);
		assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
	});

	it("publishes the protected resource metadata for /mcp", async () => {
		const response = await call("/.well-known/oauth-protected-resource/mcp");
		assert.deepEqual(await response.json(), {
			resource: RESOURCE,
			authorization_servers: [MCP_ORIGIN],
			scopes_supported: ["mail:read", "mail:rules"],
			bearer_methods_supported: ["header"],
		});
	});

	it("answers /mcp without a token with a 401 naming the resource metadata", async () => {
		const response = await listTools(undefined);
		assert.equal(response.status, 401);
		assert.match(
			response.headers.get("www-authenticate") ?? "",
			/^Bearer resource_metadata="https:\/\/mcp\.remit\.test\/\.well-known\/oauth-protected-resource\/mcp"/,
		);
	});

	it("registers, authorizes with PKCE, issues a token and serves tools/list", async () => {
		const shared = sharedRows();
		clientId = await registerClient();
		const { verifier, challenge } = pkce();
		const { code, cookie } = await authorize(clientId, challenge);
		mcpSessionCookie = cookie;
		const { status, body } = await exchange(clientId, code, verifier);
		assert.equal(status, 200, JSON.stringify(body));
		assert.ok(body.access_token && body.refresh_token);
		accessToken = body.access_token;
		refreshToken = body.refresh_token;

		const response = await listTools(accessToken);
		assert.equal(response.status, 200);
		const rpc = (await response.json()) as {
			result: { tools: { name: string }[] };
		};
		assert.deepEqual(rpc.result.tools.map((tool) => tool.name).sort(), [
			"get_message",
			"get_thread",
			"list_mailboxes",
			"list_threads",
			"search_threads",
		]);
		assert.deepEqual(sharedRows(), shared);
	});

	it("rotates the refresh token and refuses the spent one", async () => {
		const rotated = await token({
			grant_type: "refresh_token",
			client_id: clientId,
			refresh_token: refreshToken,
		});
		assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
		assert.ok(rotated.body.access_token);
		assert.ok(rotated.body.refresh_token);
		assert.notEqual(rotated.body.refresh_token, refreshToken);
		assert.equal((await listTools(rotated.body.access_token)).status, 200);

		const replayed = await token({
			grant_type: "refresh_token",
			client_id: clientId,
			refresh_token: refreshToken,
		});
		assert.equal(replayed.status, 400);
		assert.equal(replayed.body.access_token, undefined);
	});

	it("refuses an MCP token on the main API", async () => {
		const jwks = (await (
			await mainAuth.handler(new Request(`${MAIN_ORIGIN}/api/auth/jwks`))
		).json()) as JSONWebKeySet;
		const mainVerifier = createJwtVerifier(
			resolveVerifierConfig(MAIN_ORIGIN),
			createLocalJWKSet(jwks),
		);
		assert.equal((await mainVerifier(mainJwt)).sub.length > 0, true);
		await assert.rejects(mainVerifier(accessToken));
	});

	it("refuses a main session token and a main JWT on /mcp", async () => {
		for (const bearer of [mainSessionToken, mainJwt]) {
			const response = await listTools(bearer);
			assert.equal(response.status, 401);
			assert.match(
				response.headers.get("www-authenticate") ?? "",
				/error="invalid_token"/,
			);
		}
	});

	it("refuses a code exchanged with the wrong PKCE verifier", async () => {
		const { challenge } = pkce();
		const { code } = await authorize(clientId, challenge);
		const { status, body } = await exchange(clientId, code, pkce().verifier);
		assert.equal(status, 400);
		assert.equal(body.error, "invalid_grant");
		assert.equal(body.access_token, undefined);
	});

	it("refuses a redirect the client never registered", async () => {
		const { challenge } = pkce();
		const response = await call(
			authorizeUrl(clientId, challenge, {
				redirectUri: "https://claude.ai/api/mcp/other_callback",
			}),
		);
		const location = response.headers.get("location") ?? "";
		assert.ok(
			!location.startsWith("https://claude.ai/"),
			`redirected to ${location}`,
		);
		assert.ok(
			response.status >= 400 || location.includes("error="),
			`authorize answered ${response.status} ${location}`,
		);
	});

	it("refuses to register a redirect outside the allow-list", async () => {
		const response = await register(["https://evil.example/callback"]);
		assert.equal(response.status, 400);
		assert.equal(
			((await response.json()) as { error: string }).error,
			"invalid_redirect_uri",
		);
	});

	it("registers a loopback redirect", async () => {
		const response = await register(["http://127.0.0.1:33418/callback"]);
		assert.equal(response.status, 201, await response.clone().text());
	});

	it("refuses a wrong password", async () => {
		const { challenge } = pkce();
		const toLogin = locationOf(await call(authorizeUrl(clientId, challenge)));
		const response = await form("/login", {
			email: EMAIL,
			password: "wrong password",
			oauth_query: toLogin.search.slice(1),
		});
		assert.equal(response.status, 401);
		assert.equal(response.headers.getSetCookie().length, 0);
	});

	it("binds a token requested without resource to the MCP endpoint", async () => {
		const { verifier, challenge } = pkce();
		const { code } = await authorize(clientId, challenge, false);
		const { status, body } = await exchange(clientId, code, verifier, false);
		assert.equal(status, 200, JSON.stringify(body));
		assert.ok(body.access_token);
		const [, payload] = body.access_token.split(".");
		assert.ok(payload, "the access token is not a JWT");
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
			aud: string | string[];
		};
		assert.ok([claims.aud].flat().includes(RESOURCE));
		assert.equal((await listTools(body.access_token)).status, 200);
	});

	it("never writes the shared user and account rows", async () => {
		const shared = sharedRows();
		for (const [path, fields] of [
			["/auth/update-user", { name: "Changed" }],
			[
				"/auth/change-password",
				{ currentPassword: PASSWORD, newPassword: "a brand new password" },
			],
		] as const) {
			const response = await call(path, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					origin: MCP_ORIGIN,
					cookie: mcpSessionCookie,
				},
				body: JSON.stringify(fields),
			});
			assert.equal(response.status, 404, path);
		}
		await assert.rejects(
			auth.api.updateUser({
				body: { name: "Changed" },
				headers: new Headers({ cookie: mcpSessionCookie }),
			}),
			/never writes the shared auth_user or auth_account/,
		);
		assert.deepEqual(sharedRows(), shared);
	});

	it("keys the sign-in limit on the peer, not a spoofed client address", async () => {
		const { challenge } = pkce();
		const toLogin = locationOf(await call(authorizeUrl(clientId, challenge)));
		const attempt = (spoofed: string) =>
			app(
				new Request(`${MCP_ORIGIN}/login`, {
					method: "POST",
					headers: {
						"content-type": "application/x-www-form-urlencoded",
						origin: MCP_ORIGIN,
						"x-remit-client-ip": spoofed,
					},
					body: new URLSearchParams({
						email: EMAIL,
						password: "wrong password",
						oauth_query: toLogin.search.slice(1),
					}),
				}),
				"203.0.113.99",
			);
		const statuses: number[] = [];
		for (let i = 0; i < 6; i += 1) {
			statuses.push((await attempt(`198.51.100.${i + 1}`)).status);
		}
		assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
	});
});
