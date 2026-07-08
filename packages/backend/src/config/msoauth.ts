/**
 * Typed reads for Microsoft OAuth (Entra) environment variables.
 *
 * In production these are wired by CDK (see infra/stacks/dev/stacks/):
 *   - `MSOAUTH_SECRET_ARN`  — Secrets Manager ARN; Lambda calls GetSecretValue
 *     at runtime to retrieve `{"clientId":"…","clientSecret":"…"}`.
 *   - `MSOAUTH_AUTHORITY`   — OIDC authority base URL (baked in at deploy time).
 *   - `MSOAUTH_REDIRECT_URI`— OAuth callback URI (baked in at deploy time).
 *
 * For local development, set `MSOAUTH_CLIENT_ID` and `MSOAUTH_CLIENT_SECRET`
 * directly in `localhost-dev-aws.env` to bypass Secrets Manager.
 *
 * See doc/oauth-microsoft.md for the Azure portal setup runbook.
 */

export interface MsOAuthConfig {
	/** Secrets Manager ARN — present in deployed Lambda environments. */
	readonly secretArn: string | undefined;
	/** OIDC authority, e.g. `https://login.microsoftonline.com/common`. */
	readonly authority: string;
	/** OAuth redirect URI registered in the Entra app. */
	readonly redirectUri: string;
	/** Client ID — used for local dev (bypasses Secrets Manager). */
	readonly clientId: string | undefined;
	/** Client secret — used for local dev (bypasses Secrets Manager). */
	readonly clientSecret: string | undefined;
	/** Token endpoint override — used for local stubbing (bypasses default OIDC discovery). */
	readonly tokenEndpoint: string | undefined;
}

/**
 * Read Microsoft OAuth configuration from the environment.
 * Throws when mandatory values (`MSOAUTH_AUTHORITY`, `MSOAUTH_REDIRECT_URI`)
 * are absent — both are always present in deployed Lambdas and should be set
 * in `localhost-dev-aws.env` for local development.
 */
export const getMsOAuthConfig = (): MsOAuthConfig => {
	const authority = process.env.MSOAUTH_AUTHORITY;
	const redirectUri = process.env.MSOAUTH_REDIRECT_URI;

	if (!authority) {
		throw new Error(
			"MSOAUTH_AUTHORITY is not set. Wire via CDK (infra/stacks/dev/stacks/remit-api-stack.ts) or set in localhost-dev-aws.env.",
		);
	}
	if (!redirectUri) {
		throw new Error(
			"MSOAUTH_REDIRECT_URI is not set. Wire via CDK (infra/stacks/dev/stacks/remit-api-stack.ts) or set in localhost-dev-aws.env.",
		);
	}

	return {
		secretArn: process.env.MSOAUTH_SECRET_ARN,
		authority,
		redirectUri,
		clientId: process.env.MSOAUTH_CLIENT_ID,
		clientSecret: process.env.MSOAUTH_CLIENT_SECRET,
		tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT,
	};
};
