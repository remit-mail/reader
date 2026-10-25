import type { OAuthProviderConfig } from "@remit/mail-oauth-service";

export interface MsOAuthCredentials {
	clientId: string;
	clientSecret: string;
}

export interface MsOAuthEnabled {
	mode: "Enabled";
	redirectUri: string;
	// Replaces the fixed Microsoft token endpoint for local stubbing.
	overrides: Partial<Pick<OAuthProviderConfig, "tokenEndpoint">>;
	credentials: () => Promise<MsOAuthCredentials>;
}

export type MsOAuthConfig = { mode: "Disabled" } | MsOAuthEnabled;

export interface LoadedMsOAuth {
	config: MsOAuthEnabled;
	credentials: MsOAuthCredentials;
}

export const loadMsOAuth = async (
	config: MsOAuthConfig,
): Promise<LoadedMsOAuth> => {
	if (config.mode === "Disabled") {
		throw new Error(
			"No Microsoft OAuth credentials are configured on this instance: set MSOAUTH_CLIENT_ID and MSOAUTH_CLIENT_SECRET, or MSOAUTH_SECRET_ARN",
		);
	}
	return { config, credentials: await config.credentials() };
};
