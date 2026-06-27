import type {
	RemitImapMailboxResponse,
	RemitImapRenameMailboxInput,
} from "@remit/api-http-client/types.gen.ts";
import { MailboxRole } from "@remit/domain-enums";
import type { FolderDescriptor, FolderRole } from "@remit/ui";
import { getMailboxKind } from "@/lib/mailbox-order";

type MailboxRoleValue = (typeof MailboxRole)[keyof typeof MailboxRole];

/**
 * `getMailboxKind` group string → kit `FolderRole`. The vocabularies line up
 * one-to-one except that detection returns `null` for a plain user folder,
 * which the settings UI renders as the `custom` role.
 */
const KIND_TO_FOLDER_ROLE: Record<string, FolderRole> = {
	inbox: "inbox",
	drafts: "drafts",
	sent: "sent",
	archive: "archive",
	junk: "junk",
	trash: "trash",
	all: "all",
	flagged: "flagged",
};

/** The role detection mapped this mailbox to, or `custom` when none. */
export const detectFolderRole = (
	fullPath: string,
	specialUse: readonly string[] | undefined,
): FolderRole => {
	const kind = getMailboxKind(fullPath, specialUse);
	if (!kind) return "custom";
	return KIND_TO_FOLDER_ROLE[kind] ?? "custom";
};

/** Persisted `MailboxRole` (PascalCase) → kit `FolderRole` (lowercase). */
const MAILBOX_ROLE_TO_FOLDER_ROLE: Record<MailboxRoleValue, FolderRole> = {
	[MailboxRole.Inbox]: "inbox",
	[MailboxRole.Drafts]: "drafts",
	[MailboxRole.Sent]: "sent",
	[MailboxRole.Archive]: "archive",
	[MailboxRole.Junk]: "junk",
	[MailboxRole.Trash]: "trash",
	[MailboxRole.All]: "all",
	[MailboxRole.Flagged]: "flagged",
	[MailboxRole.Custom]: "custom",
};

/** Kit `FolderRole` (lowercase) → persisted `MailboxRole` (PascalCase). */
const FOLDER_ROLE_TO_MAILBOX_ROLE: Record<FolderRole, MailboxRoleValue> = {
	inbox: MailboxRole.Inbox,
	drafts: MailboxRole.Drafts,
	sent: MailboxRole.Sent,
	archive: MailboxRole.Archive,
	junk: MailboxRole.Junk,
	trash: MailboxRole.Trash,
	all: MailboxRole.All,
	flagged: MailboxRole.Flagged,
	custom: MailboxRole.Custom,
};

export const mailboxRoleToFolderRole = (role: MailboxRoleValue): FolderRole =>
	MAILBOX_ROLE_TO_FOLDER_ROLE[role] ?? "custom";

export const folderRoleToMailboxRole = (role: FolderRole): MailboxRoleValue =>
	FOLDER_ROLE_TO_MAILBOX_ROLE[role];

/**
 * Map one mailbox to the kit descriptor: the committed role is the user's
 * `roleOverride` when set, else the detected role; the committed name is the
 * `displayNameOverride` or an empty string so the row shows the canonical
 * placeholder. The kit drops `custom`-role rows itself.
 */
export const toFolderDescriptor = (
	mailbox: RemitImapMailboxResponse,
): FolderDescriptor => {
	const detectedRole = detectFolderRole(mailbox.fullPath, mailbox.specialUse);
	const role = mailbox.roleOverride
		? mailboxRoleToFolderRole(mailbox.roleOverride)
		: detectedRole;
	return {
		id: mailbox.mailboxId,
		providerPath: mailbox.fullPath,
		detectedRole,
		role,
		name: mailbox.displayNameOverride ?? "",
	};
};

export const buildFolderDescriptors = (
	mailboxes: readonly RemitImapMailboxResponse[],
): FolderDescriptor[] => mailboxes.map(toFolderDescriptor);

/**
 * PATCH body for a committed row: a trimmed name (or `null` to clear it back to
 * the canonical default) and the mapped role override.
 */
export const buildCommitBody = (next: {
	role: FolderRole;
	name: string;
}): RemitImapRenameMailboxInput => {
	const trimmed = next.name.trim();
	return {
		displayNameOverride: trimmed === "" ? null : trimmed,
		roleOverride: folderRoleToMailboxRole(next.role),
	};
};

/** PATCH body that clears both overrides back to detected defaults. */
export const buildResetBody = (): RemitImapRenameMailboxInput => ({
	displayNameOverride: null,
	roleOverride: null,
});
