export * from "./mail-oauth-service.js";
export * from "./microsoft-errors.js";
export * from "./types.js";

import type { OAuthProviderConfig } from "./types.js";

const MICROSOFT_TOKEN_ENDPOINT =
	"https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_AUTHORIZATION_ENDPOINT =
	"https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_DEFAULT_SCOPES = [
	"https://outlook.office.com/IMAP.AccessAsUser.All",
	"https://outlook.office.com/SMTP.Send",
	"offline_access",
	"openid",
	"email",
];

export function microsoftProviderConfig(opts: {
	clientId: string;
	clientSecret: string;
	overrides?: Partial<
		Pick<
			OAuthProviderConfig,
			"tokenEndpoint" | "authorizationEndpoint" | "scopes"
		>
	>;
}): OAuthProviderConfig {
	return {
		provider: "microsoft",
		clientId: opts.clientId,
		clientSecret: opts.clientSecret,
		tokenEndpoint: opts.overrides?.tokenEndpoint ?? MICROSOFT_TOKEN_ENDPOINT,
		authorizationEndpoint:
			opts.overrides?.authorizationEndpoint ?? MICROSOFT_AUTHORIZATION_ENDPOINT,
		scopes: opts.overrides?.scopes ?? MICROSOFT_DEFAULT_SCOPES,
	};
}
