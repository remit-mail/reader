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
