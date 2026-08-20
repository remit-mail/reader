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
 * Each account's appointed Trash mailbox, keyed by account. The delete
 * confirmation needs it to tell a move-to-Trash apart from a delete inside
 * Trash, which is an unrecoverable expunge and has to be asked as one (#845),
 * and apart from an account that appoints no Trash at all, where the server
 * refuses the delete outright (#846).
 *
 * A map rather than a set of ids, because the brief and Flagged answer for
 * selections that span accounts (#855): "is this row in Trash" is a question
 * about the row's own account, and "does any Trash exist" has to be answerable
 * as "no" rather than as silence.
 *
 * `hasAppointments` is data presence, never `!isLoading`. React Query v5
 * computes `isLoading` as `isPending && isFetching`, so an offline query is
 * paused and reports neither loading nor error while `data` is still
 * undefined — which read as "no Trash anywhere", and promised a reversible
 * move over an expunge that would replay on reconnect.
 */
export const useTrashByAccount = (): {
	trashByAccount: ReadonlyMap<string, string | undefined>;
	hasAppointments: boolean;
	isError: boolean;
} => {
	const { data: config, isError } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});

	const trashByAccount = useMemo(() => {
		const byAccount = new Map<string, string | undefined>();
		for (const account of config?.accounts ?? []) {
			byAccount.set(
				account.accountId,
				account.folderAppointments.find((fa) => fa.role === "Trash")?.mailboxId,
			);
		}
		return byAccount;
	}, [config]);

	return { trashByAccount, hasAppointments: config !== undefined, isError };
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
