import {
	getOAuthProviderApi,
	type OAuthOptions,
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
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { jwt } from "better-auth/plugins";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { z } from "zod";
import * as mcpTables from "./schema.js";
import { MCP_SCOPES, OFFLINE_ACCESS_SCOPE } from "./scopes.js";
import type { TokenVerifier } from "./token-verifier.js";
import type { UserAuthenticator } from "./user-authenticator.js";

export const AUTH_BASE_PATH = "/auth";
export const LOGIN_PATH = "/login";
export const CONSENT_PATH = "/consent";
export const MCP_PATH = "/mcp";
export const SIGN_IN_PATH = "/mcp/sign-in";

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
	users: UserAuthenticator;
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

const remitMcpBridge = (
	users: UserAuthenticator,
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
					const result = await users.authenticate(ctx.body);
					if (!result.ok) {
						throw new APIError("UNAUTHORIZED", {
							message: "Invalid email or password",
						});
					}
					const user = await ctx.context.internalAdapter.findUserById(
						result.user.id,
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
					matcher: (ctx) => ctx.path === "/oauth2/register",
					handler: createAuthMiddleware(async (ctx) => {
						const uris = redirectUrisOf(ctx.body);
						const refused = uris.find(
							(uri) => typeof uri !== "string" || !isAllowedRedirectUri(uri),
						);
						if (uris.length === 0 || refused !== undefined) {
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
	config: Omit<McpAuthConfig, "db">,
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
			remitMcpBridge(config.users, oauthOptions),
		],
	} satisfies BetterAuthOptions;
};

export const createMcpAuth = (config: McpAuthConfig) =>
	betterAuth(
		buildMcpAuthOptions(
			config,
			drizzleAdapter(config.db, {
				provider: "sqlite",
				schema: { ...mcpTables, auth_user, auth_account },
			}),
		),
	);

export type McpAuth = ReturnType<typeof createMcpAuth>;

export const authServerMetadataHandler = (
	auth: McpAuth,
): ((request: Request) => Promise<Response>) =>
	oauthProviderAuthServerMetadata(auth);

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
				if (error instanceof APIError) return undefined;
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
