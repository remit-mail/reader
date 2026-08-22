import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { FolderTreeNode } from "@remit/ui";
import { excludeFolder } from "./delete-folder.js";
import { buildMailboxRoleMap, labelForMailbox } from "./folder-roles.js";
import { buildMoveTargets } from "./move-targets.js";

type Translator = (key: string, fallback: string) => string;

interface MoveOptionsInput {
	mailboxes: readonly RemitImapMailboxResponse[];
	folderAppointments: readonly RemitImapFolderAppointment[];
	/** Rendered as a non-selectable row, so the user sees where mail lives now. */
	currentMailboxId?: string;
	/** Dropped entirely — the folder being deleted is not its own destination. */
	excludeMailboxId?: string;
	translator?: Translator;
}

/**
 * The account's hierarchy separator, which the tree splits paths on. Every
 * mailbox of an account reports the same one, so the first is the account's.
 */
export const folderDelimiter = (
	mailboxes: readonly RemitImapMailboxResponse[],
): string => mailboxes[0]?.hierarchyDelimiter ?? "/";

/**
 * The single shaping of a mailbox list into Move-to picker options. Labels
 * follow the account's role appointments (RFC 032, #976) and any
 * `displayNameOverride`, so a picker reads `Inbox`/`Trash` rather than the
 * provider's leaf, while the provider path it nests and filters under stays
 * untouched.
 *
 * The message count travels with every option (#887): a folder named `Trash`
 * may be an empty look-alike beside the real one, and the count is the only
 * thing that tells them apart. The Move-to picker shows it for the same reason.
 */
export const buildMoveOptions = ({
	mailboxes,
	folderAppointments,
	currentMailboxId,
	excludeMailboxId,
	translator,
}: MoveOptionsInput): FolderTreeNode[] => {
	const targets = buildMoveTargets(mailboxes, folderAppointments);
	const roleMap = buildMailboxRoleMap(folderAppointments);
	const destinations = excludeMailboxId
		? excludeFolder(targets, excludeMailboxId)
		: targets;
	return destinations.map((mailbox) => ({
		id: mailbox.mailboxId,
		label: labelForMailbox(mailbox, roleMap.get(mailbox.mailboxId), translator),
		path: mailbox.fullPath,
		isCurrent: mailbox.mailboxId === currentMailboxId,
		messageCount: mailbox.messageCount,
	}));
};
