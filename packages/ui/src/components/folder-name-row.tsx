import {
	Archive,
	Check,
	FileText,
	Folder,
	Inbox,
	Mails,
	OctagonAlert,
	RotateCcw,
	Send,
	Star,
	Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { Select } from "./select.js";

/* ------------------------------------------------------------------ */
/* Folder role vocabulary. Mirrors the sidebar's detection groups      */
/* (getMailboxKind in the web client) plus "custom" for folders that    */
/* don't map to any system role. The role drives the icon, the sidebar  */
/* pinning, and the default display name.                               */
/* ------------------------------------------------------------------ */

export type FolderRole =
	| "inbox"
	| "drafts"
	| "sent"
	| "archive"
	| "junk"
	| "trash"
	| "flagged"
	| "all"
	| "custom";

/** Picker order: system roles first, "custom" last (issue #957). */
export const FOLDER_ROLES: readonly FolderRole[] = [
	"inbox",
	"drafts",
	"sent",
	"archive",
	"junk",
	"trash",
	"flagged",
	"all",
	"custom",
];

/* Canonical English labels, matching the `sidebar.${kind}` i18n keys
   (mail.json). At the app boundary these get localized; the kit ships the
   English defaults so stories read true. "custom" has no canonical label —
   it falls back to the provider leaf name. */
const ROLE_LABEL: Record<Exclude<FolderRole, "custom">, string> = {
	inbox: "Inbox",
	drafts: "Drafts",
	sent: "Sent",
	archive: "Archive",
	junk: "Spam",
	trash: "Trash",
	flagged: "Starred",
	all: "All Mail",
};

/** Canonical label for a role, or null for "custom" (no system label). */
export function canonicalRoleLabel(role: FolderRole): string | null {
	return role === "custom" ? null : ROLE_LABEL[role];
}

/** Label shown in the role picker. */
export function roleOptionLabel(role: FolderRole): string {
	return role === "custom" ? "Custom" : ROLE_LABEL[role];
}

/** Leaf segment of a provider path (`INBOX/Spam` → `Spam`). */
export function providerLeaf(providerPath: string): string {
	const parts = providerPath.split("/");
	return parts[parts.length - 1] || providerPath;
}

/**
 * The default display name for a folder — the placeholder shown when there's
 * no override. Mirrors the resolver: `canonicalLabel(role) ?? providerLeaf`.
 */
export function folderNameDefault(
	role: FolderRole,
	providerPath: string,
): string {
	return canonicalRoleLabel(role) ?? providerLeaf(providerPath);
}

/** True when the committed values carry a name or role override. */
export function folderRowOverridden(args: {
	detectedRole: FolderRole;
	role: FolderRole;
	name: string;
}): boolean {
	return args.role !== args.detectedRole || args.name.trim() !== "";
}

/**
 * Which trailing affordance a row shows. At most one is ever visible:
 * `commit` (✔️) while the draft differs from the committed value, `reset` (↺)
 * once a committed override differs from the detected default and there's no
 * pending edit, otherwise `none`.
 */
export function folderRowAffordance(args: {
	detectedRole: FolderRole;
	role: FolderRole;
	name: string;
	draftRole: FolderRole;
	draftName: string;
}): "commit" | "reset" | "none" {
	const dirty =
		args.draftRole !== args.role || args.draftName.trim() !== args.name.trim();
	if (dirty) return "commit";
	if (
		folderRowOverridden({
			detectedRole: args.detectedRole,
			role: args.role,
			name: args.name,
		})
	) {
		return "reset";
	}
	return "none";
}

export function roleIcon(role: FolderRole): ReactNode {
	if (role === "inbox") return <Inbox className="size-4" />;
	if (role === "drafts") return <FileText className="size-4" />;
	if (role === "sent") return <Send className="size-4" />;
	if (role === "archive") return <Archive className="size-4" />;
	if (role === "junk") return <OctagonAlert className="size-4" />;
	if (role === "trash") return <Trash2 className="size-4" />;
	if (role === "flagged") return <Star className="size-4" />;
	if (role === "all") return <Mails className="size-4" />;
	return <Folder className="size-4" />;
}

export interface FolderNameRowProps {
	/** Server truth — the IMAP path. Read-only. */
	providerPath: string;
	/** What detection mapped this folder to. The reset target. */
	detectedRole: FolderRole;
	/** Committed role (may already be a user override of `detectedRole`). */
	role: FolderRole;
	/** Committed display-name override. Empty string means "use the default". */
	name: string;
	/** Seeds the editable draft; defaults to the committed role/name. */
	defaultDraft?: { role?: FolderRole; name?: string };
	/** Fires when the user commits a pending draft (the ✔️). */
	onCommit: (next: { role: FolderRole; name: string }) => void;
	/** Clears the committed override back to the detected default (the ↺). */
	onReset: () => void;
}

/**
 * One compact line of folder-naming controls: a role picker on the left (its
 * icon reflects the live role), an always-editable display-name input on the
 * right (placeholder = the canonical default for the role), and a single
 * trailing affordance — ✔️ to commit a pending edit, ↺ to reset a committed
 * override. The read-only provider path sits on a muted sub-line.
 *
 * Holds only a local draft; the caller owns the committed value.
 */
export function FolderNameRow({
	providerPath,
	detectedRole,
	role,
	name,
	defaultDraft,
	onCommit,
	onReset,
}: FolderNameRowProps) {
	const [draftRole, setDraftRole] = useState<FolderRole>(
		defaultDraft?.role ?? role,
	);
	const [draftName, setDraftName] = useState(defaultDraft?.name ?? name);

	const affordance = folderRowAffordance({
		detectedRole,
		role,
		name,
		draftRole,
		draftName,
	});

	const commit = () => onCommit({ role: draftRole, name: draftName });
	const reset = () => {
		setDraftRole(detectedRole);
		setDraftName("");
		onReset();
	};

	return (
		<div className="flex flex-col gap-0.5 border-b border-line px-row-inset py-2 last:border-b-0">
			<div className="flex items-center gap-2">
				<Select
					className="w-40 shrink-0"
					icon={roleIcon(draftRole)}
					value={draftRole}
					aria-label={`Role for ${providerPath}`}
					onChange={(event) => setDraftRole(event.target.value as FolderRole)}
				>
					{FOLDER_ROLES.map((option) => (
						<option key={option} value={option}>
							{roleOptionLabel(option)}
						</option>
					))}
				</Select>
				<Input
					className="flex-1"
					value={draftName}
					placeholder={folderNameDefault(draftRole, providerPath)}
					aria-label={`Display name for ${providerPath}`}
					onChange={(event) => setDraftName(event.target.value)}
				/>
				{affordance === "commit" && (
					<Button
						variant="ghost"
						size="sm"
						className="shrink-0"
						icon={<Check className="size-4" />}
						aria-label="Commit changes"
						onClick={commit}
					/>
				)}
				{affordance === "reset" && (
					<Button
						variant="ghost"
						size="sm"
						className="shrink-0"
						icon={<RotateCcw className="size-3.5" />}
						aria-label="Reset to detected"
						onClick={reset}
					/>
				)}
			</div>
			<span
				className="truncate pl-1 text-2xs text-fg-subtle"
				title={providerPath}
			>
				{providerPath}
			</span>
		</div>
	);
}
