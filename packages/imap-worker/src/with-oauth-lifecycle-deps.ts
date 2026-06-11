/**
 * with-oauth-lifecycle-deps.ts
 *
 * Shared construction of the deps passed to withOAuthLifecycle by every IMAP
 * handler. Centralizes the lazy OAuth token service, secrets, refresh-token
 * rotation persistence, and the connectionState writer so handlers don't each
 * re-declare the same boilerplate.
 */

import type { AccountService } from "@remit/remit-electrodb-service";
import {
	createMailOAuthService,
	microsoftProviderConfig,
} from "@remit/mail-oauth-service";
import type { SecretsService } from "@remit/secrets-service";
import type {
	ConnectionStateValue,
	OAuthLifecycleDeps,
} from "./with-oauth-lifecycle.js";

// Lazy OAuth service: created on first OAuth account.
// Uses MSOAUTH_* env vars which are only present in deployed Lambdas.
let _tokenService: ReturnType<typeof createMailOAuthService> | undefined;
const getTokenService = (): ReturnType<typeof createMailOAuthService> => {
	if (!_tokenService) {
		_tokenService = createMailOAuthService(
			microsoftProviderConfig({
				clientId: process.env.MSOAUTH_CLIENT_ID ?? "",
				clientSecret: process.env.MSOAUTH_CLIENT_SECRET ?? "",
				overrides: process.env.MSOAUTH_TOKEN_ENDPOINT
					? { tokenEndpoint: process.env.MSOAUTH_TOKEN_ENDPOINT }
					: undefined,
			}),
		);
	}
	return _tokenService;
};

/**
 * Build the OAuthLifecycleDeps for a handler. `secrets` and `accountService`
 * are the long-lived singletons already constructed at module scope in each
 * handler.
 */
export const buildLifecycleDeps = (
	secrets: SecretsService,
	accountService: AccountService,
): OAuthLifecycleDeps => ({
	secrets,
	tokenService: getTokenService(),
	persistRotatedToken: async (accountId, encryptedHash, updatedAt) => {
		await accountService.update(accountId, {
			oauthRefreshTokenHash: encryptedHash,
			oauthTokenUpdatedAt: updatedAt,
		});
	},
	updateConnectionState: async (
		accountId: string,
		state: ConnectionStateValue,
	) => {
		await accountService.update(accountId, { connectionState: state });
	},
});
