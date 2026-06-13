import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getMailboxDisplayName } from "@/lib/mailbox-order";

const ARCHIVE_NAMES = new Set(["archive", "archives", "all mail"]);

// Strip a leading backslash from IMAP special-use flags so we can compare
// bare names. Regex written without escape sequences to avoid tsgo parsing
// issues with regex literals containing backslash.
const stripLeadingBackslash = (flag: string): string =>
	flag.startsWith("\\") ? flag.slice(1) : flag;

/**
 * Returns the best archive-mailbox candidate for the given account.
 *
 * Strategy (mirrors pickCanonical in mailbox-order.ts):
 * 1. IMAP SPECIAL-USE `\Archive` (or `\All`) flag — server truth wins.
 * 2. Name-only fallback: "archive", "archives", "all mail".
 *
 * Returns `undefined` while loading or if no archive mailbox exists.
 */
export const useArchiveMailbox = (
	accountId: string | undefined,
): { archiveMailboxId: string | undefined; isLoading: boolean } => {
	const { data: mailboxesResponse, isLoading } = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: accountId ?? "" },
		}),
		staleTime: Infinity,
		enabled: !!accountId,
	});

	const archiveMailboxId = useMemo(() => {
		const mailboxes = mailboxesResponse?.items ?? [];
		if (mailboxes.length === 0) return undefined;

		// 1. Prefer a mailbox with the SPECIAL-USE \Archive (or \All) flag.
		const byFlag = mailboxes.find((m) =>
			m.specialUse?.some((f) => {
				const bare = stripLeadingBackslash(f);
				return bare === "Archive" || bare === "All";
			}),
		);
		if (byFlag) return byFlag.mailboxId;

		// 2. Fall back to name-matching.
		const byName = mailboxes.find((m) =>
			ARCHIVE_NAMES.has(getMailboxDisplayName(m.fullPath).toLowerCase()),
		);
		return byName?.mailboxId;
	}, [mailboxesResponse]);

	return { archiveMailboxId, isLoading };
};

const DRAFTS_NAMES = new Set(["drafts", "draft"]);

/**
 * Returns true when `mailboxId` is the account's IMAP `\Drafts` mailbox.
 *
 * Detection strategy (mirrors useArchiveMailbox / useJunkMailbox):
 *  1. IMAP SPECIAL-USE `\Drafts` flag — server truth wins.
 *  2. Name-only fallback: "drafts", "draft".
 *
 * Used by the mailbox route to decide whether to render the segmented
 * Drafts view (Remit drafts + IMAP \Drafts) in place of the flat message
 * list (issue #505).
 */
export const useDraftsMailbox = (
	accountId: string | undefined,
): { draftsMailboxId: string | undefined; isLoading: boolean } => {
	const { data: mailboxesResponse, isLoading } = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: accountId ?? "" },
		}),
		staleTime: Infinity,
		enabled: !!accountId,
	});

	const draftsMailboxId = useMemo(() => {
		const mailboxes = mailboxesResponse?.items ?? [];
		if (mailboxes.length === 0) return undefined;

		// 1. Prefer a mailbox with the SPECIAL-USE \Drafts flag.
		const byFlag = mailboxes.find((m) =>
			m.specialUse?.some((f) => stripLeadingBackslash(f) === "Drafts"),
		);
		if (byFlag) return byFlag.mailboxId;

		// 2. Fall back to name-matching.
		const byName = mailboxes.find((m) =>
			DRAFTS_NAMES.has(getMailboxDisplayName(m.fullPath).toLowerCase()),
		);
		return byName?.mailboxId;
	}, [mailboxesResponse]);

	return { draftsMailboxId, isLoading };
};

/**
 * Returns the account's INBOX mailbox id — the destination for "Not spam"
 * (issue #594), which moves a message out of Junk back to the inbox. Matches
 * the mailbox whose `fullPath` is exactly "INBOX" (case-insensitive), the same
 * rule the backend `findInboxMailbox` uses. `undefined` while loading or if
 * absent.
 */
export const useInboxMailbox = (
	accountId: string | undefined,
): { inboxMailboxId: string | undefined; isLoading: boolean } => {
	const { data: mailboxesResponse, isLoading } = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: accountId ?? "" },
		}),
		staleTime: Infinity,
		enabled: !!accountId,
	});

	const inboxMailboxId = useMemo(() => {
		const mailboxes = mailboxesResponse?.items ?? [];
		const found = mailboxes.find((m) => m.fullPath.toUpperCase() === "INBOX");
		return found?.mailboxId;
	}, [mailboxesResponse]);

	return { inboxMailboxId, isLoading };
};

const JUNK_NAMES = new Set(["junk", "spam", "bulk mail"]);

/**
 * Returns the Junk/Spam mailbox candidate for an account, used by the triage
 * `!` (mark junk) key (#429). The message-flags API has no `$Junk` keyword
 * field, so "mark junk" is realized as a move to the Junk mailbox — the
 * closest existing surface (mirrors archive). Prefers the SPECIAL-USE `\Junk`
 * flag, then name-matching. `undefined` while loading or if absent.
 */
export const useJunkMailbox = (
	accountId: string | undefined,
): { junkMailboxId: string | undefined; isLoading: boolean } => {
	const { data: mailboxesResponse, isLoading } = useQuery({
		...mailboxOperationsListMailboxesOptions({
			path: { accountId: accountId ?? "" },
		}),
		staleTime: Infinity,
		enabled: !!accountId,
	});

	const junkMailboxId = useMemo(() => {
		const mailboxes = mailboxesResponse?.items ?? [];
		if (mailboxes.length === 0) return undefined;

		const byFlag = mailboxes.find((m) =>
			m.specialUse?.some((f) => stripLeadingBackslash(f) === "Junk"),
		);
		if (byFlag) return byFlag.mailboxId;

		const byName = mailboxes.find((m) =>
			JUNK_NAMES.has(getMailboxDisplayName(m.fullPath).toLowerCase()),
		);
		return byName?.mailboxId;
	}, [mailboxesResponse]);

	return { junkMailboxId, isLoading };
};
