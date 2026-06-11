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
