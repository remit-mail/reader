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

/** ConnectionState is a const object (not a TS enum); this is its value type. */
export type ConnectionStateValue =
	(typeof ConnectionState)[keyof typeof ConnectionState];

/**
 * The fields that say whether an account holds a credential at all. Narrower
 * than AccountItem so a caller holding only an account summary can ask.
 */
export type StoredCredentialFields = Partial<
	Pick<AccountItem, "authType" | "passwordHash" | "oauthRefreshTokenHash">
>;

/**
 * No credential of the kind this account's authType needs is stored. An
 * imported account holds none by design until its owner types one, so this is
 * a normal state of the world rather than a fault: no retry can change it, and
 * it is distinct from a credential the mail server rejected.
 *
 * `terminalState` is the connectionState that describes the account while it
 * stays this way, decided here so nothing downstream branches on authType.
 */
export interface MissingCredential {
	readonly status: "missing";
	readonly terminalState: ConnectionStateValue;
	readonly reason: string;
}

export type CredentialResolution =
	| { readonly status: "resolved"; readonly credentials: MailCredentials }
	| MissingCredential;

type StoredCredential =
	| { readonly status: "password"; readonly passwordHash: string }
	| { readonly status: "oauthMicrosoft"; readonly refreshTokenHash: string }
	| MissingCredential;

const readStoredCredential = (
	account: StoredCredentialFields,
): StoredCredential => {
	const authType = account.authType ?? AccountAuthType.Password;

	if (authType === AccountAuthType.OauthMicrosoft) {
		if (!account.oauthRefreshTokenHash) {
			return {
				status: "missing",
				terminalState: ConnectionState.ReauthRequired,
				reason: "authType=oauthMicrosoft but no oauthRefreshTokenHash",
			};
		}
		return {
			status: "oauthMicrosoft",
			refreshTokenHash: account.oauthRefreshTokenHash,
		};
	}

	if (!account.passwordHash) {
		return {
			status: "missing",
			terminalState: ConnectionState.CredentialsMissing,
			reason: "authType=password but no passwordHash",
		};
	}
	return { status: "password", passwordHash: account.passwordHash };
};

/**
 * Whether the account holds the credential its authType requires.
 *
 * Keyed on the stored credential, never on `connectionState`: PATCH
 * /accounts/{id} writes a password without clearing `credentials_missing` —
 * only a successful connect clears it, via markAuthenticated — so a
 * state-based check would go on skipping an account that can sync perfectly
 * well.
 */
export const hasStoredCredential = (account: StoredCredentialFields): boolean =>
	readStoredCredential(account).status !== "missing";

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
 * Returns `{ status: "missing" }` when the account stores no credential —
 * an expected outcome every caller settles terminally, never retries.
 *
 * Throws `RefreshTokenError` on OAuth failures; callers should handle:
 * - `kind === "reauth-required"` → set connectionState to reauth_required, ACK
 * - `kind === "transient"` → rethrow (SQS retry)
 * - `kind === "config"` → rethrow (SQS retry / alert)
 */
export const resolveConnectionCredentials = async (
	account: AccountItem,
	deps: AccountCredentialsDeps,
): Promise<CredentialResolution> => {
	const stored = readStoredCredential(account);

	if (stored.status === "missing") {
		return stored;
	}

	if (stored.status === "oauthMicrosoft") {
		return {
			status: "resolved",
			credentials: await resolveOauthCredentials(
				account.accountId,
				stored.refreshTokenHash,
				deps,
			),
		};
	}

	return {
		status: "resolved",
		credentials: await resolvePasswordCredentials(
			stored.passwordHash,
			deps.secrets,
		),
	};
};

const resolvePasswordCredentials = async (
	passwordHash: string,
	secrets: Pick<SecretsService, "decrypt">,
): Promise<MailCredentials> => {
	const password = await secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(passwordHash)),
	);
	return { kind: "password", password };
};

const resolveOauthCredentials = async (
	accountId: string,
	refreshTokenHash: string,
	deps: AccountCredentialsDeps,
): Promise<MailCredentials> => {
	const refreshToken = await deps.secrets.decrypt(
		deserializeEncryptedPayload(JSON.parse(refreshTokenHash)),
	);

	// getAccessToken throws RefreshTokenError on failure
	const tokenSet = await deps.tokenService.getAccessToken(
		accountId,
		refreshToken,
	);

	// If the provider rotated the refresh token, persist it BEFORE returning.
	// This guarantees the new token is stored even if a subsequent error occurs.
	if (tokenSet.refreshToken) {
		const encryptedPayload = await deps.secrets.encrypt(tokenSet.refreshToken);
		const encryptedHash = JSON.stringify(
			serializeEncryptedPayload(encryptedPayload),
		);
		await deps.persistRotatedToken(accountId, encryptedHash, Date.now());
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

export { ConnectionState, RefreshTokenError };
