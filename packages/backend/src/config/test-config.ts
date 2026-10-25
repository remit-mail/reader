import type { ApiConfig } from "./api-config.js";

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
