import { Check, Folder } from "lucide-react";
import { useState } from "react";
import { Button } from "./button.js";
import {
	canonicalRoleLabel,
	type FolderRole,
	providerLeaf,
	roleIcon,
} from "./folder-role.js";
import { Input } from "./input.js";
import { Select } from "./select.js";

/* ------------------------------------------------------------------ */
/* Role-centric folder settings (RFC 032, issue #976).                 */
/*                                                                      */
/* Inverts the per-folder model: the canonical roles are the fixed     */
/* anchor, and each row appoints WHICH existing folder fills it. A role */
/* points to at most one folder, so two-"Drafts" is unrepresentable.   */
/* Replaces folder-name-row / folder-name-list.                         */
/* ------------------------------------------------------------------ */

/** The canonical roles a user appoints, in display order. */
export const APPOINTABLE_ROLES: readonly FolderRole[] = [
	"inbox",
	"drafts",
	"sent",
	"archive",
	"junk",
	"trash",
];

export interface CandidateFolder {
	/** Stable id (the mailbox id). */
	mailboxId: string;
	/** Server truth — the IMAP path. Read-only. */
	providerPath: string;
	/** Live message count, so the user can pick the folder that holds mail. */
	messageCount: number;
}

/** Empty <option> value standing for "no folder appointed". */
const NONE = "";

/** Picker option text: `Concepten · 340 msgs`. */
function folderOptionLabel(folder: CandidateFolder): string {
	const noun = folder.messageCount === 1 ? "msg" : "msgs";
	return `${providerLeaf(folder.providerPath)} · ${folder.messageCount} ${noun}`;
}

interface RoleAppointmentRowProps {
	role: FolderRole;
	folders: readonly CandidateFolder[];
	/** The mailbox appointed to this role, or null when the role is unfilled. */
	appointedId: string | null;
	/** Committed display-name override for the appointed folder. */
	displayName: string;
	onAppoint: (role: FolderRole, mailboxId: string | null) => void;
	onRename: (mailboxId: string, name: string) => void;
}

/**
 * One role row: the canonical role on the left, a picker choosing which
 * existing folder fills it (options carry message counts so the user picks the
 * folder that actually holds mail), and — once a folder is appointed — a rename
 * field for its sidebar label. Selecting a folder here clears it from any other
 * role on write; the picker can never produce a duplicate.
 */
function RoleAppointmentRow({
	role,
	folders,
	appointedId,
	displayName,
	onAppoint,
	onRename,
}: RoleAppointmentRowProps) {
	const [draftName, setDraftName] = useState(displayName);
	const appointed = folders.find((f) => f.mailboxId === appointedId) ?? null;
	const label = canonicalRoleLabel(role);
	const renameDirty =
		appointed != null && draftName.trim() !== displayName.trim();

	return (
		<div className="flex flex-col gap-1 border-b border-line px-row-inset py-2.5 last:border-b-0">
			<div className="flex items-center gap-2">
				<span className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-fg">
					{roleIcon(role)}
					{label}
				</span>
				<Select
					className="w-56 shrink-0"
					value={appointedId ?? NONE}
					aria-label={`Folder for ${label}`}
					onChange={(event) =>
						onAppoint(
							role,
							event.target.value === NONE ? null : event.target.value,
						)
					}
				>
					<option value={NONE}>None</option>
					{folders.map((folder) => (
						<option key={folder.mailboxId} value={folder.mailboxId}>
							{folderOptionLabel(folder)}
						</option>
					))}
				</Select>
				{appointed && (
					<>
						<Input
							className="flex-1"
							value={draftName}
							placeholder={label}
							aria-label={`Display name for ${label}`}
							onChange={(event) => setDraftName(event.target.value)}
						/>
						{renameDirty && (
							<Button
								variant="ghost"
								size="sm"
								className="shrink-0"
								icon={<Check className="size-4" />}
								aria-label="Save display name"
								onClick={() => onRename(appointed.mailboxId, draftName)}
							/>
						)}
					</>
				)}
			</div>
			{appointed && (
				<span
					className="truncate pl-[7.5rem] text-2xs text-fg-subtle"
					title={appointed.providerPath}
				>
					{appointed.providerPath} · {appointed.messageCount}{" "}
					{appointed.messageCount === 1 ? "message" : "messages"}
				</span>
			)}
		</div>
	);
}

export interface RoleAppointmentListProps {
	accountEmail: string;
	/** Every folder the account exposes (candidates for any role). */
	folders: readonly CandidateFolder[];
	/** role → appointed mailboxId. A missing role means "None". */
	appointments: Readonly<Record<string, string | null>>;
	/** mailboxId → committed display-name override. */
	displayNames?: Readonly<Record<string, string>>;
	onAppoint: (role: FolderRole, mailboxId: string | null) => void;
	onRename: (mailboxId: string, name: string) => void;
}

/**
 * The per-account folder-roles settings section. Lists the canonical roles,
 * each appointing one existing folder, then the leftover unappointed folders as
 * plain folders. Controlled — the caller owns the appointment map and routes
 * each change back. Pure kit primitives (Select/Input/Button); no disabled
 * controls (a picker always offers "None").
 */
export function RoleAppointmentList({
	accountEmail,
	folders,
	appointments,
	displayNames = {},
	onAppoint,
	onRename,
}: RoleAppointmentListProps) {
	const appointedIds = new Set(
		Object.values(appointments).filter((id): id is string => id != null),
	);
	const leftovers = folders.filter((f) => !appointedIds.has(f.mailboxId));

	return (
		<section className="space-y-3">
			<header className="space-y-1">
				<h2 className="text-sm font-semibold text-fg">
					Folder roles — {accountEmail}
				</h2>
				<p className="text-xs text-fg-muted">
					Each role points to one folder. Pick the folder that holds the mail —
					the counts help you tell real folders from empty look-alikes.
					Appointing a folder here removes it from any other role.
				</p>
			</header>
			<div className="rounded-sm border border-line bg-surface">
				{APPOINTABLE_ROLES.map((role) => {
					const appointedId = appointments[role] ?? null;
					return (
						<RoleAppointmentRow
							key={role}
							role={role}
							folders={folders}
							appointedId={appointedId}
							displayName={appointedId ? (displayNames[appointedId] ?? "") : ""}
							onAppoint={onAppoint}
							onRename={onRename}
						/>
					);
				})}
			</div>

			{leftovers.length > 0 && (
				<div className="space-y-1.5">
					<h3 className="text-xs font-medium text-fg-muted">Other folders</h3>
					<ul className="rounded-sm border border-line bg-surface">
						{leftovers.map((folder) => (
							<li
								key={folder.mailboxId}
								className="flex items-center gap-2 border-b border-line px-row-inset py-2 text-sm text-fg last:border-b-0"
							>
								<Folder className="size-4 shrink-0 text-fg-subtle" />
								<span className="truncate">
									{providerLeaf(folder.providerPath)}
								</span>
								<span className="ml-auto shrink-0 text-2xs text-fg-subtle">
									{folder.messageCount}{" "}
									{folder.messageCount === 1 ? "message" : "messages"}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
