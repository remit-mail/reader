import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapCanonicalMailboxRole,
	RemitImapFolderAppointment,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * RFC 032 exclusive-folder-appointment (#976): every "which mailbox plays
 * role X" question resolves from the account's `folderAppointments` map, not
 * from independently re-detecting SPECIAL-USE flags or hardcoded name lists.
 * The map is server-resolved (persisted user choice, or a proposal for
 * anything unfilled), so a single shared lookup replaces what used to be four
 * near-identical flag-then-name detectors.
 */
const useFolderRoleMailbox = (
	accountId: string | undefined,
	role: RemitImapCanonicalMailboxRole,
): { mailboxId: string | undefined; isLoading: boolean } => {
	const { data: config, isLoading } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
		enabled: !!accountId,
	});

	const mailboxId = useMemo(() => {
		if (!accountId) return undefined;
		const account = config?.accounts.find((a) => a.accountId === accountId);
		return account?.folderAppointments.find((fa) => fa.role === role)
			?.mailboxId;
	}, [config, accountId, role]);

	return { mailboxId, isLoading };
};

/**
 * Returns the account's appointed Archive mailbox id. `undefined` while
 * loading or when no folder is appointed to (or proposed for) the role.
 */
export const useArchiveMailbox = (
	accountId: string | undefined,
): { archiveMailboxId: string | undefined; isLoading: boolean } => {
	const { mailboxId, isLoading } = useFolderRoleMailbox(accountId, "Archive");
	return { archiveMailboxId: mailboxId, isLoading };
};

/**
 * Returns the account's appointed Drafts mailbox id. Used by the mailbox
 * route to decide whether to render the segmented Drafts view (Remit drafts +
 * IMAP Drafts) in place of the flat message list (issue #505).
 */
export const useDraftsMailbox = (
	accountId: string | undefined,
): { draftsMailboxId: string | undefined; isLoading: boolean } => {
	const { mailboxId, isLoading } = useFolderRoleMailbox(accountId, "Drafts");
	return { draftsMailboxId: mailboxId, isLoading };
};

/**
 * Returns the account's Inbox mailbox id — the destination for "Not spam"
 * (issue #594), which moves a message out of Junk back to the inbox.
 */
export const useInboxMailbox = (
	accountId: string | undefined,
): { inboxMailboxId: string | undefined; isLoading: boolean } => {
	const { mailboxId, isLoading } = useFolderRoleMailbox(accountId, "Inbox");
	return { inboxMailboxId: mailboxId, isLoading };
};

/**
 * Returns the account's appointed Junk/Spam mailbox id, used by the triage
 * `!` (mark junk) key (#429). The message-flags API has no `$Junk` keyword
 * field, so "mark junk" is realized as a move to the Junk mailbox.
 */
export const useJunkMailbox = (
	accountId: string | undefined,
): { junkMailboxId: string | undefined; isLoading: boolean } => {
	const { mailboxId, isLoading } = useFolderRoleMailbox(accountId, "Junk");
	return { junkMailboxId: mailboxId, isLoading };
};

/**
 * Returns an account's full role→mailbox appointment map, for callers that
 * need more than one role at once (e.g. the Move-to picker excluding both
 * Drafts and Sent, and ordering system folders by role). Empty while loading
 * or when `accountId` is undefined.
 */
export const useFolderAppointments = (
	accountId: string | undefined,
): readonly RemitImapFolderAppointment[] => {
	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
		enabled: !!accountId,
	});

	return useMemo(
		() =>
			config?.accounts.find((a) => a.accountId === accountId)
				?.folderAppointments ?? [],
		[config, accountId],
	);
};
