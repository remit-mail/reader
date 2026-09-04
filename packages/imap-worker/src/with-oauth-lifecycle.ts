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
 *  - An account storing no credential at all is terminal, not transient: the
 *    account is flipped to the state that describes it and the event is ACKed.
 *    Retrying instead fenced the account's FIFO group for the message's whole
 *    visibility timeout, blocking the sync that follows the credential the
 *    user was still typing (issue #1120).
 *  - On a terminal auth failure (RefreshTokenError reauth-required, or
 *    MailConnectionError auth), flip the account to reauth_required and return
 *    WITHOUT rethrowing — this ACKs the SQS message so it is not retried.
 *    An IMAP refusal is stored with it, because not every refusal a mail server
 *    hands back is one re-authenticating clears: "SmtpClientAuthentication is
 *    disabled" needs a tenant setting changed, and an account card that only
 *    ever says "Re-authentication required" sends the user around a loop.
 *  - On transient / config / network errors, rethrow so SQS retries with
 *    backoff (let-it-crash).
 *
 * Tokens must NEVER appear in logs — only accountId / errorKind / errorCode.
 */

import type { AccountItem } from "@remit/data-ports";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import type { Logger } from "@remit/logger-lambda";
import { RefreshTokenError } from "@remit/mail-oauth-service";
import {
	type AccountCredentialsDeps,
	type ConnectionStateValue,
	type CredentialResolution,
	resolveConnectionCredentials,
} from "@remit/mailbox-service/account-credentials";
import {
	MailConnectionError,
	type MailCredentials,
} from "@remit/mailbox-service/types";
import { isAccountReauthRequired } from "./account-check.js";

export type { ConnectionStateValue };

/**
 * A refusal is a sentence, not a transcript. Long enough for what a mail server
 * says when it refuses a login, short enough that a chatty one cannot fill the
 * column or the card.
 */
const LAST_ERROR_MAX_LENGTH = 500;

export interface OAuthLifecycleDeps extends AccountCredentialsDeps {
	/**
	 * Persist the account's connectionState, and with it the sentence the
	 * account card shows for the failure. `lastError` carries the server's own
	 * words when the failure came with any; it is absent only when nothing was
	 * said, as for a credential that was never stored.
	 */
	updateConnectionState: (
		accountId: string,
		state: ConnectionStateValue,
		lastError?: string,
	) => Promise<void>;
	/**
	 * Resolve credentials for the account. Defaults to
	 * resolveConnectionCredentials; overridable for testing. Kept as the ONLY
	 * authType branch in the codebase (see account-credentials.ts).
	 */
	resolveCredentials?: (
		account: AccountItem,
		deps: AccountCredentialsDeps,
	) => Promise<CredentialResolution>;
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
		const resolution = await resolve(account, deps);
		if (resolution.status === "missing") {
			log.warn(
				{
					accountId: account.accountId,
					reason: resolution.reason,
					connectionState: resolution.terminalState,
				},
				"Account stores no credential; acking the event without IMAP traffic",
			);
			await deps.updateConnectionState(
				account.accountId,
				resolution.terminalState,
			);
			return; // ACK — no retry can produce a credential
		}
		await work(resolution.credentials);
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
					error: err.message,
				},
				"IMAP auth rejected; marking account reauth_required",
			);
			await deps.updateConnectionState(
				account.accountId,
				ConnectionState.ReauthRequired,
				err.message.slice(0, LAST_ERROR_MAX_LENGTH),
			);
			return; // ACK — do not retry
		}

		// Transient / network / unexpected: rethrow so SQS retries with backoff.
		throw err;
	}
};
