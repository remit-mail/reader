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
