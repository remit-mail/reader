import type { AccountItem } from "@remit/data-ports";
import type { Logger } from "@remit/remit-logger-lambda";

/**
 * RFC 2606 reserved placeholder namespaces that are guaranteed never to resolve
 * and are not used by any local/dev/e2e environment: `.invalid` (the actual
 * smoke-test placeholder) and `.example`. An account pointed at one of these can
 * never connect, so syncing it would retry and dead-letter forever — we skip it.
 *
 * `localhost`/`.localhost` and `.test` are deliberately NOT skipped: the e2e and
 * mailfuzz suites run their IMAP server on `localhost`, and `.test` is commonly
 * used for local testing.
 */
const RESERVED_NAMES = ["invalid", "example"] as const;
const RESERVED_HOST_SUFFIXES = RESERVED_NAMES.map((name) => `.${name}`);

/**
 * True when `host` is a reserved placeholder name that can never resolve.
 *
 * Matches the bare `invalid`/`example` and any subdomain of those namespaces
 * (`mail.example`, `foo.invalid`, …). Suffix matching is anchored on the dot so
 * real hosts like `invalid.com` or `imap.gmail.com` are NOT treated as reserved.
 */
export const isReservedHost = (host: string): boolean => {
	const normalized = host.trim().toLowerCase();
	if (RESERVED_NAMES.includes(normalized as (typeof RESERVED_NAMES)[number])) {
		return true;
	}
	return RESERVED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

/**
 * Check if an account's IMAP host can never resolve (reserved TLD).
 * Returns true if the account should be skipped cleanly — no connection
 * attempt, no thrown error, so the event is acked rather than dead-lettered.
 */
export const isUnsyncableHost = (
	account: AccountItem,
	log: Logger,
): boolean => {
	if (isReservedHost(account.imapHost)) {
		log.warn(
			{ accountId: account.accountId, imapHost: account.imapHost },
			"Skipping account: IMAP host is a reserved, never-resolvable name",
		);
		return true;
	}
	return false;
};

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
