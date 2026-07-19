/**
 * account-credentials.ts
 *
 * Single place in the codebase that branches on account.authType.
 * All sync handlers (IMAP, SMTP) must call resolveConnectionCredentials
 * rather than duplicating credential logic.
 *
 * Grep-verifiable constraint: `account.authType` must only appear here.
 */

import type { AccountItem } from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import type { MailOAuthService } from "@remit/mail-oauth-service";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	deserializeEncryptedPayload,
	type SecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import type { MailCredentials } from "./types.js";

export interface AccountCredentialsDeps {
	secrets: Pick<SecretsService, "decrypt" | "encrypt">;
	tokenService: Pick<MailOAuthService, "getAccessToken">;
	/**
	 * Called when the OAuth provider rotated the refresh token.
	 * Must be awaited BEFORE the credentials are returned so the new token
	 * is persisted before any IMAP command is issued.
	 */
	persistRotatedToken: (
		accountId: string,
		encryptedHash: string,
		updatedAt: number,
	) => Promise<void>;
}

/**
 * Resolve IMAP credentials for an account.
 *
 * - Password accounts: decrypt passwordHash → return password credential.
 * - OAuth accounts: decrypt oauthRefreshTokenHash → mint access token via
 *   tokenService.  If the provider rotated the refresh token, persist the
 *   new token via `deps.persistRotatedToken` BEFORE returning credentials.
 *
 * Throws `RefreshTokenError` on OAuth failures; callers should handle:
 * - `kind === "reauth-required"` → set connectionState to reauth_required, ACK
 * - `kind === "transient"` → rethrow (SQS retry)
 * - `kind === "config"` → rethrow (SQS retry / alert)
 */
export const resolveConnectionCredentials = async (
	account: AccountItem,
	deps: AccountCredentialsDeps,
): Promise<MailCredentials> => {
	const authType = account.authType ?? AccountAuthType.Password;

	if (authType === AccountAuthType.OauthMicrosoft) {
		return resolveOauthCredentials(account, deps);
	}

	// Default: password auth
	return resolvePasswordCredentials(account, deps.secrets);
};

const resolvePasswordCredentials = async (
	account: AccountItem,
	secrets: Pick<SecretsService, "decrypt">,
): Promise<MailCredentials> => {
	if (!account.passwordHash) {
		throw new Error(
			`Account ${account.accountId} has authType=password but no passwordHash`,
		);
	}
	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.passwordHash)),
	);
	return { kind: "password", password };
};

const resolveOauthCredentials = async (
	account: AccountItem,
	deps: AccountCredentialsDeps,
): Promise<MailCredentials> => {
	if (!account.oauthRefreshTokenHash) {
		throw new Error(
			`Account ${account.accountId} has authType=oauthMicrosoft but no oauthRefreshTokenHash`,
		);
	}

	const refreshToken = await deps.secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(account.oauthRefreshTokenHash)),
	);

	// getAccessToken throws RefreshTokenError on failure
	const tokenSet = await deps.tokenService.getAccessToken(
		account.accountId,
		refreshToken,
	);

	// If the provider rotated the refresh token, persist it BEFORE returning.
	// This guarantees the new token is stored even if a subsequent error occurs.
	if (tokenSet.refreshToken) {
		const encryptedPayload = await deps.secrets.encrypt(tokenSet.refreshToken);
		const encryptedHash = JSON.stringify(
			serializeEncryptedPayload(encryptedPayload),
		);
		await deps.persistRotatedToken(
			account.accountId,
			encryptedHash,
			Date.now(),
		);
	}

	return { kind: "accessToken", accessToken: tokenSet.accessToken };
};

/**
 * Build the encrypted hash string for an OAuth refresh token.
 * Helper used when first storing an OAuth token (e.g. after OAuth callback).
 */
export const encryptRefreshToken = async (
	refreshToken: string,
	secrets: Pick<SecretsService, "encrypt">,
): Promise<string> => {
	const payload = await secrets.encrypt(refreshToken);
	return JSON.stringify(serializeEncryptedPayload(payload));
};

export { RefreshTokenError, ConnectionState };
