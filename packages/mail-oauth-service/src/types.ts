export interface OAuthProviderConfig {
	provider: "microsoft"; // union grows later
	clientId: string;
	clientSecret: string;
	/** Default: https://login.microsoftonline.com/common/oauth2/v2.0/token */
	tokenEndpoint: string;
	/** Default: https://login.microsoftonline.com/common/oauth2/v2.0/authorize */
	authorizationEndpoint: string;
	scopes: string[];
}

export interface TokenSet {
	accessToken: string;
	/** Epoch seconds */
	expiresAt: number;
	/** Present when provider rotated the refresh token — caller MUST persist */
	refreshToken?: string;
	/** Present when the provider returns an OpenID Connect ID token (e.g. Microsoft
	 *  when openid+email scopes are requested). Contains user identity claims. */
	idToken?: string;
}

export type RefreshError =
	| { kind: "reauth-required"; code: string } // invalid_grant family
	| { kind: "transient"; code: string } // network, 5xx, 429
	| { kind: "config"; code: string }; // bad client secret, consent revoked

export class RefreshTokenError extends Error {
	constructor(public readonly error: RefreshError) {
		super(`OAuth refresh failed: ${error.kind} (${error.code})`);
		this.name = "RefreshTokenError";
	}
}
