import {
	DEVICE_CODE_GRANT_TYPE,
	getOAuthProviderApi,
	type OAuthOptions,
	oauthDeviceAuthorization,
	oauthProvider,
	oauthProviderAuthServerMetadata,
	type Scope,
} from "@better-auth/oauth-provider";
import { CLIENT_IP_HEADER } from "@remit/auth-service";
import { auth_account, auth_user } from "@remit/auth-service/schema";
import {
	type BetterAuthOptions,
	type BetterAuthPlugin,
	betterAuth,
	type GenericEndpointContext,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	getSessionFromCtx,
	isAPIError,
	sessionMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import { refuseSharedTableWrites } from "./database.js";
import { checkRemitPassword } from "./remit-password.js";
import * as mcpTables from "./schema.js";
import { MCP_SCOPES, OFFLINE_ACCESS_SCOPE } from "./scopes.js";
import type { TokenVerifier } from "./token-verifier.js";

export const AUTH_BASE_PATH = "/auth";
export const LOGIN_PATH = "/login";
export const CONSENT_PATH = "/consent";
export const DEVICE_PATH = "/device";
export const CONNECTED_APPS_PATH = "/apps";
export const MCP_PATH = "/mcp";
export const SIGN_IN_PATH = "/mcp/sign-in";
export const CONNECTED_APPS_API_PATH = "/mcp/connected-apps";
export const REVOKE_CLIENT_API_PATH = "/mcp/revoke-client";
export const JWKS_PATH = "/jwks";
export const OAUTH2_PATH_PREFIX = "/oauth2/";
export const DEVICE_CODE_PATH = "/device/code";
export const DEVICE_APPROVE_PATH = "/device/approve";
export const DEVICE_DENY_PATH = "/device/deny";

export const ALLOWED_REDIRECT_URIS = [
	"https://claude.ai/api/mcp/auth_callback",
	"https://claude.com/api/mcp/auth_callback",
] as const;

export const DEVICE_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;
export const BROWSER_TOKEN_TTL_SECONDS = 60 * 60;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const isAllowedRedirectUri = (uri: string): boolean => {
	if ((ALLOWED_REDIRECT_URIS as readonly string[]).includes(uri)) return true;
	if (!URL.canParse(uri)) return false;
	const url = new URL(uri);
	return (
		url.protocol === "http:" &&
		LOOPBACK_HOSTS.has(url.hostname) &&
		url.username === "" &&
		url.password === "" &&
		url.hash === ""
	);
};

export interface McpAuthConfig {
	origin: string;
	secret: string;
	db: BetterSQLite3Database;
}

export const mcpResource = (origin: string): string => `${origin}${MCP_PATH}`;

const modelNames = {
	oauthClient: { modelName: "mcp_oauth_client" },
	oauthResource: { modelName: "mcp_oauth_resource" },
	oauthClientResource: { modelName: "mcp_oauth_client_resource" },
	oauthRefreshToken: { modelName: "mcp_oauth_refresh_token" },
	oauthAccessToken: { modelName: "mcp_oauth_access_token" },
	oauthConsent: { modelName: "mcp_oauth_consent" },
	oauthClientAssertion: { modelName: "mcp_oauth_client_assertion" },
};

const buildOAuthOptions = (origin: string): OAuthOptions<Scope[]> => {
	const resource = mcpResource(origin);
	return {
		schema: modelNames,
		scopes: [...MCP_SCOPES, OFFLINE_ACCESS_SCOPE],
		grantTypes: ["authorization_code", "refresh_token"],
		// A refreshable token stays short; the device flow, which a static
		// header carries and nothing refreshes, gets the long default. Every
		// browser authorization is made refreshable by the authorize hook.
		accessTokenExpiresIn: DEVICE_TOKEN_TTL_SECONDS,
		scopeExpirations: {
			[OFFLINE_ACCESS_SCOPE]: `${BROWSER_TOKEN_TTL_SECONDS}s`,
		},
		loginPage: `${origin}${LOGIN_PATH}`,
		consentPage: `${origin}${CONSENT_PATH}`,
		allowDynamicClientRegistration: true,
		allowUnauthenticatedClientRegistration: true,
		clientRegistrationDefaultApplicationType: "infer",
		resources: [{ identifier: resource, name: "remit mail" }],
		clientRegistrationDefaultResources: [resource],
	};
};

const redirectUrisOf = (body: unknown): unknown[] => {
	if (typeof body !== "object" || body === null) return [];
	const uris = (body as { redirect_uris?: unknown }).redirect_uris;
	return Array.isArray(uris) ? uris : [];
};

const grantTypesOf = (body: unknown): unknown[] => {
	if (typeof body !== "object" || body === null) return [];
	const grantTypes = (body as { grant_types?: unknown }).grant_types;
	return Array.isArray(grantTypes) ? grantTypes : [];
};

const isDeviceOnlyClient = (body: unknown): boolean => {
	const grantTypes = grantTypesOf(body);
	return (
		grantTypes.includes(DEVICE_CODE_GRANT_TYPE) &&
		!grantTypes.includes("authorization_code")
	);
};

const withOfflineAccess = (query: Record<string, unknown>) => {
	if (typeof query.scope !== "string") return query;
	const scopes = query.scope.split(" ").filter((scope) => scope.length > 0);
	if (scopes.includes(OFFLINE_ACCESS_SCOPE)) return query;
	return { ...query, scope: [...scopes, OFFLINE_ACCESS_SCOPE].join(" ") };
};

const userCodeOf = (body: unknown): string | undefined => {
	if (typeof body !== "object" || body === null) return undefined;
	const userCode = (body as { userCode?: unknown }).userCode;
	return typeof userCode === "string" ? userCode : undefined;
};

interface DeviceCodeRow {
	oauthClientId: string | null;
	scope: string | null;
	resources: string[] | null;
}

const deviceCodeOf = async (
	ctx: GenericEndpointContext,
	userCode: string,
): Promise<DeviceCodeRow | null> => {
	const find = (value: string) =>
		ctx.context.adapter.findOne<DeviceCodeRow>({
			model: "deviceCode",
			where: [{ field: "userCode", value }],
		});
	return (
		(await find(userCode)) ??
		(await find(userCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()))
	);
};

const hasResource = (fields: unknown): boolean =>
	typeof fields === "object" &&
	fields !== null &&
	(fields as { resource?: unknown }).resource !== undefined;

interface ConsentRow {
	clientId: string;
	scopes: string[];
	createdAt: Date;
}

interface ClientRow {
	name: string | null;
}

interface ConnectedApp {
	clientId: string;
	clientName: string;
	scopes: string[];
	connectedAt: Date;
}

const grantOf = (userId: string, clientId: string) => [
	{ field: "userId", value: userId },
	{ field: "clientId", value: clientId },
];

const remitMcpBridge = (
	db: BetterSQLite3Database,
	resource: string,
	oauthOptions: OAuthOptions<Scope[]>,
) =>
	({
		id: "remit-mcp",
		endpoints: {
			remitMcpSignIn: createAuthEndpoint(
				SIGN_IN_PATH,
				{
					method: "POST",
					body: z.object({
						email: z.string(),
						password: z.string(),
						oauth_query: z.string(),
					}),
				},
				async (ctx) => {
					const result = await checkRemitPassword(
						db,
						ctx.body.email,
						ctx.body.password,
					);
					if (!result.ok) {
						throw new APIError("UNAUTHORIZED", {
							message: "Invalid email or password",
						});
					}
					const user = await ctx.context.internalAdapter.findUserById(
						result.userId,
					);
					if (!user) {
						throw new APIError("UNAUTHORIZED", {
							message: "Invalid email or password",
						});
					}
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ redirect: false });
				},
			),
			remitMcpVerifyAccessToken: createAuthEndpoint(
				"/mcp/verify-access-token",
				{
					method: "POST",
					body: z.object({ token: z.string() }),
					metadata: { SERVER_ONLY: true },
				},
				async (ctx) => {
					const payload = await getOAuthProviderApi(
						ctx,
						oauthOptions,
					).requireActiveAccessToken(ctx.body.token);
					const clientId = payload.azp ?? payload.client_id;
					if (typeof payload.sub !== "string" || typeof clientId !== "string") {
						throw new APIError("UNAUTHORIZED", { error: "invalid_token" });
					}
					const consent = await ctx.context.adapter.findOne({
						model: "oauthConsent",
						where: grantOf(payload.sub, clientId),
					});
					if (!consent) {
						throw new APIError("UNAUTHORIZED", {
							error: "invalid_token",
							error_description: "The user disconnected this client",
						});
					}
					return ctx.json(payload);
				},
			),
			remitMcpConnectedApps: createAuthEndpoint(
				CONNECTED_APPS_API_PATH,
				{ method: "GET", use: [sessionMiddleware] },
				async (ctx) => {
					const consents = await ctx.context.adapter.findMany<ConsentRow>({
						model: "oauthConsent",
						where: [{ field: "userId", value: ctx.context.session.user.id }],
					});
					const apps = new Map<string, ConnectedApp>();
					for (const consent of consents) {
						const known = apps.get(consent.clientId);
						if (known) {
							known.scopes = [...new Set([...known.scopes, ...consent.scopes])];
							continue;
						}
						const client = await ctx.context.adapter.findOne<ClientRow>({
							model: "oauthClient",
							where: [{ field: "clientId", value: consent.clientId }],
						});
						apps.set(consent.clientId, {
							clientId: consent.clientId,
							clientName: client?.name ?? consent.clientId,
							scopes: consent.scopes,
							connectedAt: consent.createdAt,
						});
					}
					return ctx.json({ apps: [...apps.values()] });
				},
			),
			remitMcpRevokeClient: createAuthEndpoint(
				REVOKE_CLIENT_API_PATH,
				{
					method: "POST",
					use: [sessionMiddleware],
					body: z.object({ client_id: z.string().min(1) }),
				},
				async (ctx) => {
					const grant = grantOf(
						ctx.context.session.user.id,
						ctx.body.client_id,
					);
					const revoked = new Date();
					await ctx.context.adapter.deleteMany({
						model: "oauthConsent",
						where: grant,
					});
					await ctx.context.adapter.updateMany({
						model: "oauthRefreshToken",
						where: grant,
						update: { revoked },
					});
					await ctx.context.adapter.updateMany({
						model: "oauthAccessToken",
						where: grant,
						update: { revoked },
					});
					return ctx.json({ revoked: true });
				},
			),
		},
		hooks: {
			before: [
				{
					matcher: (ctx) => ctx.path === "/oauth2/authorize",
					handler: createAuthMiddleware(async (ctx) => {
						const query = withOfflineAccess(ctx.query ?? {});
						return {
							context: {
								query: hasResource(query) ? query : { ...query, resource },
							},
						};
					}),
				},
				{
					matcher: (ctx) => ctx.path === DEVICE_APPROVE_PATH,
					handler: createAuthMiddleware(async (ctx) => {
						const session = await getSessionFromCtx(ctx);
						const userCode = userCodeOf(ctx.body);
						if (!session || !userCode) return;
						const deviceCode = await deviceCodeOf(ctx, userCode);
						if (!deviceCode?.oauthClientId) return;
						const client = await ctx.context.adapter.findOne<{
							userId: string | null;
						}>({
							model: "oauthClient",
							where: [{ field: "clientId", value: deviceCode.oauthClientId }],
						});
						if (client?.userId && client.userId !== session.user.id) {
							throw new APIError("FORBIDDEN", {
								error: "access_denied",
								error_description: "This device belongs to another account",
							});
						}
						await ctx.context.adapter.update({
							model: "oauthClient",
							where: [{ field: "clientId", value: deviceCode.oauthClientId }],
							update: { userId: session.user.id },
						});
					}),
				},
				{
					matcher: (ctx) =>
						ctx.path === "/oauth2/token" && !hasResource(ctx.body),
					handler: createAuthMiddleware(async (ctx) => ({
						context: { body: { ...ctx.body, resource } },
					})),
				},
				{
					matcher: (ctx) =>
						ctx.path === DEVICE_CODE_PATH && !hasResource(ctx.body),
					handler: createAuthMiddleware(async (ctx) => ({
						context: { body: { ...ctx.body, resource } },
					})),
				},
				{
					matcher: (ctx) => ctx.path === "/oauth2/register",
					handler: createAuthMiddleware(async (ctx) => {
						const uris = redirectUrisOf(ctx.body);
						const refused = uris.find(
							(uri) => typeof uri !== "string" || !isAllowedRedirectUri(uri),
						);
						const missing = uris.length === 0 && !isDeviceOnlyClient(ctx.body);
						if (missing || refused !== undefined) {
							throw new APIError("BAD_REQUEST", {
								error: "invalid_redirect_uri",
								error_description: `redirect_uris must be ${ALLOWED_REDIRECT_URIS.join(" or ")}, or a loopback address`,
							});
						}
					}),
				},
			],
			after: [
				{
					matcher: (ctx) => ctx.path === DEVICE_APPROVE_PATH,
					handler: createAuthMiddleware(async (ctx) => {
						if (isAPIError(ctx.context.returned)) return;
						const session = await getSessionFromCtx(ctx);
						const userCode = userCodeOf(ctx.body);
						if (!session || !userCode) return;
						const deviceCode = await deviceCodeOf(ctx, userCode);
						if (!deviceCode?.oauthClientId) return;
						const grant = grantOf(session.user.id, deviceCode.oauthClientId);
						const existing = await ctx.context.adapter.findOne({
							model: "oauthConsent",
							where: grant,
						});
						if (existing) return;
						const now = new Date();
						await ctx.context.adapter.create({
							model: "oauthConsent",
							data: {
								clientId: deviceCode.oauthClientId,
								userId: session.user.id,
								scopes: (deviceCode.scope ?? "")
									.split(" ")
									.filter((scope) => scope.length > 0),
								resources: deviceCode.resources ?? [resource],
								createdAt: now,
								updatedAt: now,
							},
						});
					}),
				},
			],
		},
	}) satisfies BetterAuthPlugin;

export const buildMcpAuthOptions = (
	config: McpAuthConfig,
	database: BetterAuthOptions["database"],
) => {
	const oauthOptions = buildOAuthOptions(config.origin);
	return {
		secret: config.secret,
		baseURL: config.origin,
		basePath: AUTH_BASE_PATH,
		trustedOrigins: [config.origin],
		database,
		disabledPaths: ["/token"],
		advanced: {
			cookiePrefix: "remit-mcp",
			ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
		},
		rateLimit: {
			enabled: true,
			customRules: { [SIGN_IN_PATH]: { window: 60, max: 5 } },
		},
		user: { modelName: "auth_user" },
		account: { modelName: "auth_account" },
		session: { modelName: "mcp_session", storeSessionInDatabase: true },
		verification: { modelName: "mcp_verification" },
		plugins: [
			jwt({
				schema: { jwks: { modelName: "mcp_jwks" } },
				disableSettingJwtHeader: true,
				jwt: { issuer: config.origin, audience: mcpResource(config.origin) },
			}),
			oauthProvider(oauthOptions),
			oauthDeviceAuthorization({
				schema: { deviceCode: { modelName: "mcp_device_code" } },
				verificationUri: `${config.origin}${DEVICE_PATH}`,
			}),
			remitMcpBridge(config.db, mcpResource(config.origin), oauthOptions),
		],
	} satisfies BetterAuthOptions;
};

export const createMcpAuth = (config: McpAuthConfig) =>
	betterAuth(
		buildMcpAuthOptions(
			config,
			drizzleAdapter(refuseSharedTableWrites(config.db), {
				provider: "sqlite",
				schema: { ...mcpTables, auth_user, auth_account },
			}),
		),
	);

export type McpAuth = ReturnType<typeof createMcpAuth>;

export interface SignIn {
	email: string;
	password: string;
	oauth_query: string;
}

export interface McpAuthRoutes {
	handle(request: Request): Promise<Response>;
	serverMetadata(request: Request): Promise<Response>;
	hasSession(headers: Headers): Promise<boolean>;
	signIn(headers: Headers, body: SignIn): Promise<Response>;
	consent(
		headers: Headers,
		body: { accept: boolean; oauth_query: string },
	): Promise<Response>;
	clientName(headers: Headers, clientId: string): Promise<string | undefined>;
	claimDeviceCode(headers: Headers, userCode: string): Promise<boolean>;
	decideDeviceCode(
		headers: Headers,
		userCode: string,
		approve: boolean,
	): Promise<Response>;
	connectedApps(headers: Headers): Promise<Response>;
	revokeClient(headers: Headers, clientId: string): Promise<Response>;
}

const DEVICE_AUTH_PATHS: ReadonlySet<string> = new Set([
	DEVICE_CODE_PATH,
	DEVICE_PATH,
	DEVICE_APPROVE_PATH,
	DEVICE_DENY_PATH,
]);

const jsonHeaders = (headers: Headers): Headers => {
	const json = new Headers(headers);
	json.set("accept", "application/json");
	json.set("content-type", "application/json");
	return json;
};

const postToRouter = (
	auth: McpAuth,
	headers: Headers,
	path: string,
	body: SignIn | { accept: boolean; oauth_query: string },
): Promise<Response> =>
	auth.handler(
		new Request(`${auth.options.baseURL}${AUTH_BASE_PATH}${path}`, {
			method: "POST",
			headers: jsonHeaders(headers),
			body: JSON.stringify(body),
		}),
	);

const refusedWith = (error: unknown): undefined => {
	if (isAPIError(error)) return undefined;
	throw error;
};

const isServedAuthPath = (path: string): boolean =>
	path.startsWith(OAUTH2_PATH_PREFIX) ||
	DEVICE_AUTH_PATHS.has(path) ||
	path === SIGN_IN_PATH ||
	path === CONNECTED_APPS_API_PATH ||
	path === REVOKE_CLIENT_API_PATH ||
	path === JWKS_PATH;

export const createMcpAuthRoutes = (auth: McpAuth): McpAuthRoutes => ({
	handle: async (request) => {
		const { pathname } = new URL(request.url);
		if (!pathname.startsWith(AUTH_BASE_PATH)) {
			return new Response("Not found", { status: 404 });
		}
		if (!isServedAuthPath(pathname.slice(AUTH_BASE_PATH.length))) {
			return new Response("Not found", { status: 404 });
		}
		return auth.handler(request);
	},
	serverMetadata: oauthProviderAuthServerMetadata(auth),
	hasSession: async (headers) =>
		(await auth.api.getSession({ headers })) !== null,
	// These two go through the router rather than auth.api: only the router
	// applies the sign-in rate limit, and the authorization they resume needs
	// a request.
	signIn: (headers, body) => postToRouter(auth, headers, SIGN_IN_PATH, body),
	consent: (headers, body) =>
		postToRouter(auth, headers, "/oauth2/consent", body),
	clientName: async (headers, clientId) => {
		const client = await auth.api
			.getOAuthClientPublic({ query: { client_id: clientId }, headers })
			.catch(refusedWith);
		if (!client) return undefined;
		return client.client_name ?? clientId;
	},
	claimDeviceCode: async (headers, userCode) => {
		const response = await auth.api.deviceVerify({
			query: { user_code: userCode },
			headers,
			asResponse: true,
		});
		await response.body?.cancel();
		return response.ok;
	},
	decideDeviceCode: (headers, userCode, approve) =>
		approve
			? auth.api.deviceApprove({
					body: { userCode },
					headers: jsonHeaders(headers),
					asResponse: true,
				})
			: auth.api.deviceDeny({
					body: { userCode },
					headers: jsonHeaders(headers),
					asResponse: true,
				}),
	connectedApps: (headers) =>
		auth.api.remitMcpConnectedApps({ headers, asResponse: true }),
	revokeClient: (headers, clientId) =>
		auth.api.remitMcpRevokeClient({
			body: { client_id: clientId },
			headers: jsonHeaders(headers),
			asResponse: true,
		}),
});

const audienceOf = (aud: unknown): string[] => {
	if (typeof aud === "string") return [aud];
	if (Array.isArray(aud)) {
		return aud.filter((value): value is string => typeof value === "string");
	}
	return [];
};

export const createBetterAuthTokenVerifier = (
	auth: McpAuth,
	origin: string,
): TokenVerifier => ({
	async verify(bearer) {
		const payload = await auth.api
			.remitMcpVerifyAccessToken({ body: { token: bearer } })
			.catch((error: unknown) => {
				if (isAPIError(error)) return undefined;
				throw error;
			});
		if (!payload) return { ok: false, reason: "invalid_token" };
		if (!audienceOf(payload.aud).includes(mcpResource(origin))) {
			return { ok: false, reason: "wrong_audience" };
		}
		if (typeof payload.sub !== "string" || payload.sub.length === 0) {
			return { ok: false, reason: "no_subject" };
		}
		const scopes =
			typeof payload.scope === "string"
				? payload.scope.split(" ").filter((scope) => scope.length > 0)
				: [];
		return { ok: true, principal: { userId: payload.sub, scopes } };
	},
});
