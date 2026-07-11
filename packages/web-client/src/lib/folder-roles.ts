import type {
	RemitImapCanonicalMailboxRole,
	RemitImapFolderAppointment,
} from "@remit/api-http-client/types.gen.ts";
import type { NavMailboxRole } from "@remit/ui";

/**
 * RFC 032 exclusive-folder-appointment (#976): the sidebar, the move-to
 * picker, and the per-role hooks all resolve a mailbox's role from the
 * account's `folderAppointments` map — never by re-detecting it from the
 * folder's name or IMAP flags. The map is server-computed (persisted choice,
 * or a proposal for anything unfilled) and exclusive by construction: a role
 * points at exactly one mailbox, so there is nothing left to dedupe or guess
 * at client-side.
 */

/** `CanonicalMailboxRole` (PascalCase, wire) → kit `NavMailboxRole` (lowercase). */
export const CANONICAL_TO_NAV_ROLE: Record<string, NavMailboxRole> = {
	Inbox: "inbox",
	Drafts: "drafts",
	Sent: "sent",
	Archive: "archive",
	Junk: "junk",
	Trash: "trash",
	All: "all",
	Flagged: "flagged",
};

/** Kit `NavMailboxRole`/`FolderRole` (lowercase) → wire `CanonicalMailboxRole`. */
export const NAV_ROLE_TO_CANONICAL: Record<
	NavMailboxRole,
	RemitImapCanonicalMailboxRole
> = {
	inbox: "Inbox",
	drafts: "Drafts",
	sent: "Sent",
	archive: "Archive",
	junk: "Junk",
	trash: "Trash",
	all: "All",
	flagged: "Flagged",
};

// Display/pin priority, matching the kit's own ROLE_ORDER (nav-sidebar.tsx).
// Used to pick a single role when one mailbox is (unusually) appointed to more
// than one — the RFC allows this, but a sidebar row shows one role — and to
// order the move-to picker's system-folder rows.
export const ROLE_PRIORITY: readonly NavMailboxRole[] = [
	"inbox",
	"flagged",
	"drafts",
	"sent",
	"archive",
	"all",
	"junk",
	"trash",
];

/**
 * Reverse the role→mailboxId appointment map into mailboxId→role, so a
 * mailbox row can look up its own role in O(1). When a mailbox is appointed to
 * more than one role, the highest-priority role wins for display purposes.
 */
export function buildMailboxRoleMap(
	appointments: readonly RemitImapFolderAppointment[],
): Map<string, NavMailboxRole> {
	const byMailbox = new Map<string, NavMailboxRole>();
	const sorted = [...appointments].sort(
		(a, b) =>
			ROLE_PRIORITY.indexOf(CANONICAL_TO_NAV_ROLE[a.role]) -
			ROLE_PRIORITY.indexOf(CANONICAL_TO_NAV_ROLE[b.role]),
	);
	for (const appointment of sorted) {
		if (!appointment.mailboxId) continue;
		if (byMailbox.has(appointment.mailboxId)) continue;
		const role = CANONICAL_TO_NAV_ROLE[appointment.role];
		if (role) byMailbox.set(appointment.mailboxId, role);
	}
	return byMailbox;
}

/** Leaf segment of a provider path (`INBOX/Spam` → `Spam`). */
export const getMailboxDisplayName = (fullPath: string): string => {
	const parts = fullPath.split("/");
	return parts[parts.length - 1] || fullPath;
};

type Translator = (key: string, fallback: string) => string;

/**
 * Render-ready label: a trimmed `displayNameOverride` wins, else the
 * canonical localized label for the appointed role, else the provider leaf.
 */
export function labelForMailbox(
	mailbox: { fullPath: string; displayNameOverride?: string },
	role: NavMailboxRole | undefined,
	t?: Translator,
): string {
	const override = mailbox.displayNameOverride?.trim();
	if (override) return override;
	const leaf = getMailboxDisplayName(mailbox.fullPath);
	if (!role || !t) return leaf;
	return t(`sidebar.${role}`, leaf);
}

// Roles where a user-action-oriented unread badge isn't useful: Sent/Drafts
// weren't sent TO the user, and Trash is deleted mail (issue #195).
const COUNTLESS_ROLES = new Set<NavMailboxRole>(["sent", "drafts", "trash"]);

export const shouldShowUnreadBadgeForRole = (
	role: NavMailboxRole | undefined,
): boolean => role === undefined || !COUNTLESS_ROLES.has(role);
