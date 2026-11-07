import type { ApiConfig, AuthConfig } from "./api-config.js";

export const testSelfHostAuth = (
	overrides: Partial<Extract<AuthConfig, { mode: "BetterAuthJwt" }>> = {},
): AuthConfig => ({
	mode: "BetterAuthJwt",
	contentSigningSecret: "s".repeat(32),
	signIn: "Enabled",
	selfSignUp: "Enabled",
	...overrides,
});

export const testApiConfig = (
	overrides: Partial<ApiConfig> = {},
): ApiConfig => ({
	auth: { mode: "GatewayAuthorizer" },
	corsAllowedOrigins: [],
	publicOrigin: "https://reader.test",
	contentDeliveryDomain: "https://content.test",
	msOAuth: { mode: "Disabled" },
	selfUpdate: "Disabled",
	updateControlDir: "/data/control",
	commit: "dev",
	responseValidation: "Skip",
	...overrides,
});
