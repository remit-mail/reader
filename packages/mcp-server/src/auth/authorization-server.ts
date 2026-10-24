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
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	isAPIError,
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
export const MCP_PATH = "/mcp";
export const SIGN_IN_PATH = "/mcp/sign-in";
export const JWKS_PATH = "/jwks";
export const OAUTH2_PATH_PREFIX = "/oauth2/";
export const DEVICE_CODE_PATH = "/device/code";
export const DEVICE_VERIFY_PATH = "/device";
export const DEVICE_APPROVE_PATH = "/device/approve";
export const DEVICE_DENY_PATH = "/device/deny";

export const ALLOWED_REDIRECT_URIS = [
	"https://claude.ai/api/mcp/auth_callback",
	"https://claude.com/api/mcp/auth_callback",
] as const;

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

const hasResource = (fields: unknown): boolean =>
	typeof fields === "object" &&
	fields !== null &&
	(fields as { resource?: unknown }).resource !== undefined;

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
				async (ctx) =>
					ctx.json(
						await getOAuthProviderApi(
							ctx,
							oauthOptions,
						).requireActiveAccessToken(ctx.body.token),
					),
			),
		},
		hooks: {
			before: [
				{
					matcher: (ctx) =>
						ctx.path === "/oauth2/authorize" && !hasResource(ctx.query),
					handler: createAuthMiddleware(async (ctx) => ({
						context: { query: { ...ctx.query, resource } },
					})),
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

export interface McpAuthRoutes {
	handle(request: Request): Promise<Response>;
	serverMetadata(request: Request): Promise<Response>;
}

const DEVICE_AUTH_PATHS: ReadonlySet<string> = new Set([
	DEVICE_CODE_PATH,
	DEVICE_VERIFY_PATH,
	DEVICE_APPROVE_PATH,
	DEVICE_DENY_PATH,
]);

const isServedAuthPath = (path: string): boolean =>
	path.startsWith(OAUTH2_PATH_PREFIX) ||
	DEVICE_AUTH_PATHS.has(path) ||
	path === SIGN_IN_PATH ||
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
