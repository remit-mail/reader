import type { AccountItem } from "@remit/remit-electrodb-service";
import type { Logger } from "@remit/logger-lambda";

/**
 * Check if an account is deleted (tombstone pattern).
 * Returns true if the account should be skipped.
 */
export const isAccountDeleted = (
	account: AccountItem,
	log: Logger,
): boolean => {
	if (account.deletedAt) {
		log.info(
			{ accountId: account.accountId, deletedAt: account.deletedAt },
			"Skipping deleted account",
		);
		return true;
	}
	return false;
};

/**
 * Check if an account requires re-authentication (e.g. OAuth token revoked).
 * Returns true if the account should be skipped until the user re-auths.
 */
export const isAccountReauthRequired = (
	account: AccountItem,
	log: Logger,
): boolean => {
	if (account.connectionState === "reauth_required") {
		log.info(
			{
				accountId: account.accountId,
				connectionState: account.connectionState,
			},
			"Skipping account: reauth required",
		);
		return true;
	}
	return false;
};
