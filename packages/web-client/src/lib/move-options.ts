import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import type { MoveMailboxOption } from "@remit/ui";
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
 * The single shaping of a mailbox list into Move-to picker options. Labels
 * follow the account's role appointments (RFC 032, #976) and any
 * `displayNameOverride`, so a picker reads `Inbox`/`Trash` rather than the
 * provider's leaf; the full path stays searchable.
 */
export const buildMoveOptions = ({
	mailboxes,
	folderAppointments,
	currentMailboxId,
	excludeMailboxId,
	translator,
}: MoveOptionsInput): MoveMailboxOption[] => {
	const targets = buildMoveTargets(mailboxes, folderAppointments);
	const roleMap = buildMailboxRoleMap(folderAppointments);
	const destinations = excludeMailboxId
		? excludeFolder(targets, excludeMailboxId)
		: targets;
	return destinations.map((mailbox) => ({
		id: mailbox.mailboxId,
		label: labelForMailbox(mailbox, roleMap.get(mailbox.mailboxId), translator),
		searchValue: mailbox.fullPath,
		isCurrent: mailbox.mailboxId === currentMailboxId,
	}));
};
