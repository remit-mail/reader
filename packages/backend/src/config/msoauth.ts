import {
	createMailOAuthService,
	type MailOAuthService,
	microsoftProviderConfig,
	type OAuthProviderConfig,
} from "@remit/mail-oauth-service";

export interface MsOAuthCredentials {
	clientId: string;
	clientSecret: string;
}

/** Where a connected Outlook account's mail server is reached instead of Microsoft's. */
export interface MailServerOverride {
	host: string;
	port: number;
	tls: boolean;
	startTls: boolean;
}

export interface MsOAuthOverrides
	extends Partial<Pick<OAuthProviderConfig, "tokenEndpoint">> {
	imapServer?: MailServerOverride;
	smtpServer?: MailServerOverride;
}

export interface MsOAuthEnabled {
	mode: "Enabled";
	redirectUri: string;
	// Replace Microsoft's token endpoint and mail servers for local stubbing.
	overrides: MsOAuthOverrides;
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

export type MicrosoftTokenService = Pick<MailOAuthService, "getAccessToken">;

/**
 * The access-token minting a connected Outlook account syncs and sends with.
 * The app's credentials load on the first token asked for, and once loaded the
 * service keeps its token cache for every account after it.
 */
export const microsoftTokenService = (
	msOAuth: MsOAuthConfig,
): MicrosoftTokenService => {
	let service: Promise<MailOAuthService> | undefined;
	const load = (): Promise<MailOAuthService> =>
		loadMsOAuth(msOAuth).then(({ config, credentials }) =>
			createMailOAuthService(
				microsoftProviderConfig({
					clientId: credentials.clientId,
					clientSecret: credentials.clientSecret,
					overrides: config.overrides,
				}),
			),
		);
	return {
		getAccessToken: (cacheKey, refreshToken) => {
			service ??= load().catch((error: unknown) => {
				service = undefined;
				throw error;
			});
			return service.then((loaded) =>
				loaded.getAccessToken(cacheKey, refreshToken),
			);
		},
	};
};
