import type {
	RemitImapFolderAppointment,
	RemitImapMailboxResponse,
} from "@remit/api-http-client/types.gen.ts";
import {
	buildMailboxRoleMap,
	getMailboxDisplayName,
	ROLE_PRIORITY,
} from "./folder-roles.js";

// Outbox has no IMAP special-use flag (RFC 6154 doesn't define one) and isn't
// a canonical role (RFC 032 exclusive-folder-appointment) either — it's
// Remit's own concept, so it isn't in the account's role map. KISS: covers the
// languages we expect to encounter; extend as needed. Stored lowercased and
// trimmed; comparisons normalize the input the same way.
const OUTBOX_LOCALE_NAMES: ReadonlySet<string> = new Set([
	"outbox",
	"postvak uit",
	"boîte d'envoi",
	"postausgang",
	"buzón de salida",
	"posta in uscita",
	"送信トレイ",
	"送件匣",
	"发件箱",
	"skrzynka nadawcza",
]);

const isOutboxDestination = (mailbox: RemitImapMailboxResponse): boolean => {
	const leaf = getMailboxDisplayName(mailbox.fullPath).trim().toLowerCase();
	return OUTBOX_LOCALE_NAMES.has(leaf);
};

const NON_SYSTEM_PRIORITY = ROLE_PRIORITY.length;

/**
 * Filter and order a flat mailbox list for the Move-to picker (RFC 032
 * exclusive-folder-appointment, #976).
 *
 * Drops the account's appointed Drafts and Sent mailboxes (issue #236) —
 * compose/SMTP flows manage those, moving an arbitrary message into them
 * would break the invariant that they only hold messages the user authored —
 * and Outbox by locale name. Everything else, including a Drafts/Sent
 * look-alike the user hasn't actually appointed (e.g. an empty `INBOX/Drafts`
 * twin next to the real `INBOX/Concepten`), is a perfectly valid destination:
 * the exclusion follows the account's role appointment, not folder-name or
 * SPECIAL-USE guessing. Sorts by the same role priority the sidebar pins by,
 * then alphabetically.
 */
export const buildMoveTargets = (
	mailboxes: readonly RemitImapMailboxResponse[],
	folderAppointments: readonly RemitImapFolderAppointment[] = [],
): RemitImapMailboxResponse[] => {
	const roleMap = buildMailboxRoleMap(folderAppointments);
	const filtered = mailboxes.filter((mailbox) => {
		const role = roleMap.get(mailbox.mailboxId);
		if (role === "drafts" || role === "sent") return false;
		return !isOutboxDestination(mailbox);
	});
	return [...filtered].sort((a, b) => {
		const aPriority = roleMap.has(a.mailboxId)
			? ROLE_PRIORITY.indexOf(roleMap.get(a.mailboxId) ?? "inbox")
			: NON_SYSTEM_PRIORITY;
		const bPriority = roleMap.has(b.mailboxId)
			? ROLE_PRIORITY.indexOf(roleMap.get(b.mailboxId) ?? "inbox")
			: NON_SYSTEM_PRIORITY;
		if (aPriority !== bPriority) return aPriority - bPriority;
		return getMailboxDisplayName(a.fullPath).localeCompare(
			getMailboxDisplayName(b.fullPath),
			undefined,
			{ sensitivity: "base", numeric: true },
		);
	});
};
