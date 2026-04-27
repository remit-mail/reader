import {
	type AccountItem,
	ForbiddenError,
	NotFoundError,
} from "@remit/remit-electrodb-service";

/**
 * Cross-tenant ownership guard for accounts.
 *
 * `mode: "read"` throws NotFoundError on mismatch (404) so we don't leak the
 * existence of another tenant's account on a GET. `mode: "act"` throws
 * ForbiddenError on mismatch (403) for action verbs (PATCH/POST/DELETE) where
 * the caller has already named the resource and the API contract says we
 * explicitly deny rather than feign 404.
 *
 * Mirrors `assertOutboxOwnership` in `outbox.ts` (PR #213).
 */
export const assertAccountOwnership = (
	account: Pick<AccountItem, "accountId" | "accountConfigId">,
	callerAccountConfigId: string,
	mode: "read" | "act",
): void => {
	if (account.accountConfigId === callerAccountConfigId) return;
	if (mode === "read") {
		throw new NotFoundError(`Account not found: ${account.accountId}`);
	}
	throw new ForbiddenError(
		`Account ${account.accountId} not in account config`,
	);
};
