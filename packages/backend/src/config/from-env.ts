import type { ApiConfig, AuthConfig } from "./api-config.js";
import type { MsOAuthConfig, MsOAuthCredentials } from "./msoauth.js";
import { msOAuthCredentialsFromSecret } from "./msoauth-secrets-manager.js";

const DEFAULT_UPDATE_CONTROL_DIR = "/data/control";

const optional = (env: NodeJS.ProcessEnv, key: string): string | undefined =>
	env[key] || undefined;

const required = (
	env: NodeJS.ProcessEnv,
	key: string,
	reason: string,
): string => {
	const value = optional(env, key);
	if (!value)
		throw new Error(`Refusing to start: ${key} is not set. ${reason}`);
	return value;
};

const commaList = (raw: string | undefined): readonly string[] =>
	(raw ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0);

const authFromEnv = (env: NodeJS.ProcessEnv): AuthConfig =>
	env.DATA_BACKEND === "sqlite"
		? {
				mode: "BetterAuthJwt",
				contentSigningSecret: required(
					env,
					"BETTER_AUTH_SECRET",
					"The self-host SQL backend signs content URLs with it.",
				),
			}
		: { mode: "GatewayAuthorizer" };

const contentDeliveryDomainFromEnv = (
	env: NodeJS.ProcessEnv,
	auth: AuthConfig,
	publicOrigin: string,
): string => {
	if (auth.mode === "BetterAuthJwt") {
		return optional(env, "CONTENT_DELIVERY_DOMAIN") ?? publicOrigin;
	}
	return required(
		env,
		"CONTENT_DELIVERY_DOMAIN",
		"BodyPartResponse.contentUrl is built from the CloudFront distribution domain (#299); wire it via the API Lambda env (see infra/bin/infra.ts).",
	);
};

const msOAuthCredentialsFromEnv = (
	env: NodeJS.ProcessEnv,
): (() => Promise<MsOAuthCredentials>) | undefined => {
	const clientId = optional(env, "MSOAUTH_CLIENT_ID");
	const clientSecret = optional(env, "MSOAUTH_CLIENT_SECRET");
	if (clientId && clientSecret) {
		return async () => ({ clientId, clientSecret });
	}
	const secretArn = optional(env, "MSOAUTH_SECRET_ARN");
	if (secretArn) return msOAuthCredentialsFromSecret(secretArn);
	return undefined;
};

const msOAuthFromEnv = (env: NodeJS.ProcessEnv): MsOAuthConfig => {
	const credentials = msOAuthCredentialsFromEnv(env);
	if (!credentials) return { mode: "Disabled" };
	const tokenEndpoint = optional(env, "MSOAUTH_TOKEN_ENDPOINT");
	return {
		mode: "Enabled",
		redirectUri: required(
			env,
			"MSOAUTH_REDIRECT_URI",
			"It is derived from PUBLIC_ORIGIN — set PUBLIC_ORIGIN in the deploy env file (deploy/vps/.env) and restart, or set MSOAUTH_REDIRECT_URI directly.",
		),
		overrides: tokenEndpoint ? { tokenEndpoint } : {},
		credentials,
	};
};

export const configFromEnv = (env: NodeJS.ProcessEnv): ApiConfig => {
	const publicOrigin = required(
		env,
		"PUBLIC_ORIGIN",
		"It is the origin the web client is served from.",
	);
	const auth = authFromEnv(env);
	return {
		auth,
		corsAllowedOrigins: commaList(env.CORS_ALLOWED_ORIGINS),
		publicOrigin,
		contentDeliveryDomain: contentDeliveryDomainFromEnv(
			env,
			auth,
			publicOrigin,
		),
		msOAuth: msOAuthFromEnv(env),
		selfUpdate: optional(env, "REMIT_UPDATE_MANIFEST_URL")
			? "Enabled"
			: "Disabled",
		updateControlDir:
			optional(env, "REMIT_UPDATE_CONTROL_DIR") ?? DEFAULT_UPDATE_CONTROL_DIR,
		commit:
			optional(env, "REMIT_WORKER_SHA") ?? optional(env, "GITHUB_SHA") ?? "dev",
		responseValidation: env.STAGE_NAME === "dev" ? "Log" : "Skip",
	};
};
