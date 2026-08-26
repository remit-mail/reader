/**
 * Typed reads for Microsoft OAuth (Entra) environment variables.
 *
 * `MSOAUTH_REDIRECT_URI` is derived from `PUBLIC_ORIGIN` by the compose file
 * (deploy/vps/docker-compose.sqlite.yml) and must match the redirect URI
 * registered on the Entra app registration.
 *
 * Credentials come either from `MSOAUTH_CLIENT_ID` / `MSOAUTH_CLIENT_SECRET`
 * in the deploy env file, or from Secrets Manager via `MSOAUTH_SECRET_ARN`.
 *
 * The Microsoft authorization and token endpoints are fixed in
 * `@remit/mail-oauth-service`; no authority URL is read from the environment.
 */

export interface MsOAuthConfig {
	/** Secrets Manager ARN — an alternative to the client id/secret pair. */
	readonly secretArn: string | undefined;
	/** OAuth redirect URI registered in the Entra app. */
	readonly redirectUri: string;
	/** Client ID — set directly to bypass Secrets Manager. */
	readonly clientId: string | undefined;
	/** Client secret — set directly to bypass Secrets Manager. */
	readonly clientSecret: string | undefined;
	/** Token endpoint override — used for local stubbing (bypasses default OIDC discovery). */
	readonly tokenEndpoint: string | undefined;
}

/**
 * Read Microsoft OAuth configuration from the environment.
 * Throws when `MSOAUTH_REDIRECT_URI` is absent.
 */
export const getMsOAuthConfig = (): MsOAuthConfig => {
	const redirectUri = process.env.MSOAUTH_REDIRECT_URI;

	if (!redirectUri) {
		throw new Error(
			"MSOAUTH_REDIRECT_URI is not set. It is derived from PUBLIC_ORIGIN — set PUBLIC_ORIGIN in the deploy env file (deploy/vps/.env) and restart, or set MSOAUTH_REDIRECT_URI directly.",
		);
	}

	return {
		secretArn: process.env.MSOAUTH_SECRET_ARN,
		redirectUri,
		clientId: process.env.MSOAUTH_CLIENT_ID,
		clientSecret: process.env.MSOAUTH_CLIENT_SECRET,
		tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT,
	};
};
