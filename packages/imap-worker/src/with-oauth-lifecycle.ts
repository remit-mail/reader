/**
 * with-oauth-lifecycle.ts
 *
 * Centralizes the OAuth reauth/ACK contract shared by every IMAP handler.
 *
 * The contract (see issue #472):
 *  - If the account already requires reauth, skip all IMAP traffic entirely.
 *  - Credential resolution AND the per-handler work both run inside one
 *    try/catch so that a revoked OAuth token is caught regardless of where it
 *    surfaces (token mint vs. first IMAP command).
 *  - On a terminal auth failure (RefreshTokenError reauth-required, or
 *    MailConnectionError auth), flip the account to reauth_required and return
 *    WITHOUT rethrowing — this ACKs the SQS message so it is not retried.
 *  - On transient / config / network errors, rethrow so SQS retries with
 *    backoff (let-it-crash).
 *
 * Tokens must NEVER appear in logs — only accountId / errorKind / errorCode.
 */

import type { AccountItem } from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import type { Logger } from "@remit/remit-logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	type AccountCredentialsDeps,
	MailConnectionError,
	type MailCredentials,
	resolveConnectionCredentials,
} from "@remit/mailbox-service";
import { isAccountReauthRequired } from "./account-check.js";

/** ConnectionState is a const object (not a TS enum); this is its value type. */
export type ConnectionStateValue =
	(typeof ConnectionState)[keyof typeof ConnectionState];

export interface OAuthLifecycleDeps extends AccountCredentialsDeps {
	/**
	 * Persist the account's connectionState. Called when a terminal auth
	 * failure is detected so the account is fenced off until the user re-auths.
	 */
	updateConnectionState: (
		accountId: string,
		state: ConnectionStateValue,
	) => Promise<void>;
	/**
	 * Resolve credentials for the account. Defaults to
	 * resolveConnectionCredentials; overridable for testing. Kept as the ONLY
	 * authType branch in the codebase (see account-credentials.ts).
	 */
	resolveCredentials?: (
		account: AccountItem,
		deps: AccountCredentialsDeps,
	) => Promise<MailCredentials>;
}

/**
 * Run `work` for an account under the shared OAuth reauth/ACK contract.
 *
 * `work` receives the resolved MailCredentials. Both credential resolution and
 * `work` run inside the same try/catch.
 */
export const withOAuthLifecycle = async (
	deps: OAuthLifecycleDeps,
	account: AccountItem,
	log: Logger,
	work: (credentials: MailCredentials) => Promise<void>,
): Promise<void> => {
	// Skip all IMAP traffic for accounts that already require reauth.
	if (isAccountReauthRequired(account, log)) {
		return;
	}

	const resolve = deps.resolveCredentials ?? resolveConnectionCredentials;

	try {
		const credentials = await resolve(account, deps);
		await work(credentials);
	} catch (err) {
		// Terminal OAuth failure: token revoked / consent withdrawn.
		if (err instanceof RefreshTokenError) {
			if (err.error.kind === "reauth-required") {
				log.warn(
					{
						accountId: account.accountId,
						errorKind: err.error.kind,
						errorCode: err.error.code,
					},
					"OAuth token revoked; marking account reauth_required",
				);
				await deps.updateConnectionState(
					account.accountId,
					ConnectionState.ReauthRequired,
				);
				return; // ACK — do not retry
			}
			// transient or config: let-it-crash (SQS retry / DLQ)
			throw err;
		}

		// Terminal auth failure at the IMAP layer (bad credentials / expired token).
		// Only OAuth accounts can recover via the re-auth flow; password accounts
		// have no such path so we rethrow to preserve pre-PR batch-item-failure
		// behaviour instead of permanently fencing the account.
		if (err instanceof MailConnectionError && err.kind === "auth") {
			if (account.authType !== AccountAuthType.OauthMicrosoft) {
				throw err;
			}
			log.warn(
				{
					accountId: account.accountId,
					errorKind: err.kind,
				},
				"IMAP auth rejected; marking account reauth_required",
			);
			await deps.updateConnectionState(
				account.accountId,
				ConnectionState.ReauthRequired,
			);
			return; // ACK — do not retry
		}

		// Transient / network / unexpected: rethrow so SQS retries with backoff.
		throw err;
	}
};
