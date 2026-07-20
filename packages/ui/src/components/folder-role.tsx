import {
	Archive,
	FileText,
	Inbox,
	Mails,
	OctagonAlert,
	Send,
	Star,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Folder role vocabulary (RFC 032 exclusive-folder-appointment,       */
/* issue #976). The canonical roles are a fixed anchor set the user     */
/* appoints an existing folder to — see RoleAppointmentList. A folder   */
/* the account exposes but nobody appointed has no role at all; there   */
/* is no "custom" role member here (unlike the per-folder role picker   */
/* this replaced) because a plain folder simply carries no role.        */
/* ------------------------------------------------------------------ */

export type FolderRole =
	| "inbox"
	| "drafts"
	| "sent"
	| "archive"
	| "junk"
	| "trash"
	| "flagged"
	| "all";

/* Canonical English labels, matching the `sidebar.${role}` i18n keys
   (mail.json). At the app boundary these get localized; the kit ships the
   English defaults so stories read true. */
const ROLE_LABEL: Record<FolderRole, string> = {
	inbox: "Inbox",
	drafts: "Drafts",
	sent: "Sent",
	archive: "Archive",
	junk: "Spam",
	trash: "Trash",
	flagged: "Starred",
	all: "All Mail",
};

/** Canonical label for a role. */
export function canonicalRoleLabel(role: FolderRole): string {
	return ROLE_LABEL[role];
}

/** Leaf segment of a provider path (`INBOX/Spam` → `Spam`). */
export function providerLeaf(providerPath: string): string {
	const parts = providerPath.split("/");
	return parts[parts.length - 1] || providerPath;
}

/* ------------------------------------------------------------------ */
/* Provenance: where a search result actually lives                    */
/* ------------------------------------------------------------------ */

/**
 * The folder a search result was read from. `role` is the account's IMAP
 * special-use appointment (`junk` is `\Junk`); accounts that expose a folder
 * nobody appointed carry only a `providerPath`.
 */
export interface ResultFolder {
	role?: FolderRole;
	/** Provider path as the server spells it, e.g. `Projects/Bookkeeping`. */
	providerPath?: string;
}

/**
 * Roles that name a view rather than a place a message is filed. A message in
 * All Mail or Starred is also somewhere real, so labelling a result with one of
 * these says nothing about where it came from.
 */
const VIRTUAL_ROLES: ReadonlySet<FolderRole> = new Set(["all", "flagged"]);

export function isVirtualFolderRole(role: FolderRole): boolean {
	return VIRTUAL_ROLES.has(role);
}

/**
 * Gmail exposes its views as ordinary folders under a reserved namespace. An
 * account that appointed no role to them leaves the path as the only signal, so
 * the namespace is matched by name — the one place a name is the honest test,
 * because it is the provider's own reserved prefix and not a user's folder.
 *
 * Accounts provisioned under googlemail.com get the same namespace spelled
 * `[Google Mail]`, so both forms count. A user folder plainly called `Gmail`
 * does not — the brackets are what make the prefix reserved.
 */
const GMAIL_NAMESPACES: ReadonlySet<string> = new Set([
	"[Gmail]",
	"[Google Mail]",
]);

/**
 * Label for the folder a result came from, or `undefined` when that folder is a
 * view rather than a place — in which case no label is better than a misleading
 * one. An appointed role wins over the provider's spelling, so a folder the
 * account calls `Junk` still reads as "Spam".
 */
export function provenanceFolderLabel(
	folder: ResultFolder,
): string | undefined {
	if (folder.role) {
		if (isVirtualFolderRole(folder.role)) return undefined;
		return canonicalRoleLabel(folder.role);
	}
	if (!folder.providerPath) return undefined;
	if (GMAIL_NAMESPACES.has(folder.providerPath.split("/")[0])) return undefined;
	return providerLeaf(folder.providerPath);
}

export function roleIcon(role: FolderRole): ReactNode {
	if (role === "inbox") return <Inbox className="size-4" />;
	if (role === "drafts") return <FileText className="size-4" />;
	if (role === "sent") return <Send className="size-4" />;
	if (role === "archive") return <Archive className="size-4" />;
	if (role === "junk") return <OctagonAlert className="size-4" />;
	if (role === "trash") return <Trash2 className="size-4" />;
	if (role === "flagged") return <Star className="size-4" />;
	return <Mails className="size-4" />;
}
