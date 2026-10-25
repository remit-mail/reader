import type { MsOAuthConfig } from "./msoauth.js";

export type AuthConfig =
	| { mode: "BetterAuthJwt"; contentSigningSecret: string }
	| { mode: "GatewayAuthorizer" };

export type ResponseValidation = "Log" | "Skip";

export type SelfUpdate = "Enabled" | "Disabled";

export interface ApiConfig {
	auth: AuthConfig;
	corsAllowedOrigins: readonly string[];
	publicOrigin: string;
	contentDeliveryDomain: string;
	msOAuth: MsOAuthConfig;
	selfUpdate: SelfUpdate;
	updateControlDir: string;
	commit: string;
	responseValidation: ResponseValidation;
}
