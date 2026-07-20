/**
 * Where a search result was read from.
 *
 * A global search returns rows from every folder of every account, so each row
 * says where it came from and spam is held out of the list. Both questions are
 * answered by joining the row's mailbox ids against the mailbox lists the
 * sidebar already loads: the id → folder map here is the only thing either
 * needs, so neither the search API nor the semantic index has to carry a folder.
 *
 * The role comes from the account's `folderAppointments` map (RFC 032), which
 * the server resolves from the IMAP SPECIAL-USE attributes — so `junk` means the
 * folder the account advertises as `\Junk`, whatever it is called. Names are
 * never consulted.
 */
import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import { provenanceFolderLabel, type ResultFolder } from "@remit/ui";
import { buildMailboxRoleMap } from "./folder-roles.js";

export type ResultFolderIndex = ReadonlyMap<string, ResultFolder>;

export const EMPTY_RESULT_FOLDER_INDEX: ResultFolderIndex = new Map();

export interface AccountMailboxes {
	folderAppointments: readonly RemitImapFolderAppointment[];
	mailboxes: readonly Pick<
		RemitImapMailboxResponse,
		"mailboxId" | "fullPath"
	>[];
}

export function buildResultFolderIndex(
	accounts: readonly AccountMailboxes[],
): ResultFolderIndex {
	const index = new Map<string, ResultFolder>();
	for (const account of accounts) {
		const roles = buildMailboxRoleMap(account.folderAppointments);
		for (const mailbox of account.mailboxes) {
			const role = roles.get(mailbox.mailboxId);
			index.set(mailbox.mailboxId, {
				...(role ? { role } : {}),
				providerPath: mailbox.fullPath,
			});
		}
	}
	return index;
}

export interface ResolvedResultFolder {
	mailboxId?: string;
	folder?: ResultFolder;
}

/**
 * The mailbox a result should be attributed to, and its folder.
 *
 * A message can sit in several mailboxes at once — Gmail files a copy of most
 * mail in All Mail — and the order the ids arrive in carries no meaning, so the
 * first id that names a real place wins. `provenanceFolderLabel` is the test:
 * it is undefined exactly for the folders that are views rather than places.
 * With nothing resolvable the first id is still returned, because opening the
 * result needs a mailbox even when labelling it does not.
 */
export function resolveResultFolder(
	folders: ResultFolderIndex | undefined,
	mailboxIds: readonly string[],
): ResolvedResultFolder {
	const first = mailboxIds[0];
	if (!folders) return first ? { mailboxId: first } : {};

	for (const mailboxId of mailboxIds) {
		const folder = folders.get(mailboxId);
		if (folder && provenanceFolderLabel(folder) !== undefined) {
			return { mailboxId, folder };
		}
	}

	if (!first) return {};
	const folder = folders.get(first);
	return { mailboxId: first, ...(folder ? { folder } : {}) };
}
