import { Check, Folder } from "lucide-react";
import { useId, useRef, useState } from "react";
import { folderLeaf } from "../lib/folder-tree.js";
import { Banner } from "./banner.js";
import { Button } from "./button.js";
import {
	canonicalRoleLabel,
	type FolderRole,
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
	/** How the folder's own server separates path segments; `""` means flat. */
	hierarchyDelimiter: string;
	/** Live message count, so the user can pick the folder that holds mail. */
	messageCount: number;
}

/** Where a role's answer came from (#887). */
export type RoleAppointmentSource =
	| "Appointed"
	| "Flagged"
	| "Reserved"
	| "Proposed"
	| "Stale"
	| "None";

export interface RoleAppointment {
	/** The mailbox the role resolves to, or null when it resolves to none. */
	mailboxId: string | null;
	source: RoleAppointmentSource;
	/** `Stale` only: the path the folder the user chose last had. */
	staleFolderPath?: string;
}

/** Empty <option> value standing for "no folder appointed". */
const NONE = "";

const UNRESOLVED: RoleAppointment = { mailboxId: null, source: "None" };

/** Picker option text: `Concepten · 340 msgs`. */
function folderOptionLabel(folder: CandidateFolder): string {
	const noun = folder.messageCount === 1 ? "msg" : "msgs";
	const leaf = folderLeaf(folder.providerPath, folder.hierarchyDelimiter);
	return `${leaf} · ${folder.messageCount} ${noun}`;
}

const messages = (count: number): string =>
	`${count} ${count === 1 ? "message" : "messages"}`;

/**
 * The provenance clause in front of the path and count. Read the source rather
 * than inferring it from the shape of the row: only `Appointed` means a person
 * decided, and `Proposed` is a name match nobody confirmed.
 */
const provenanceClause = (
	source: RoleAppointmentSource,
	roleLabel: string,
): string => {
	if (source === "Appointed") return "Chosen by you";
	if (source === "Flagged") return `The mail server marks it as ${roleLabel}`;
	if (source === "Reserved") return "The account's own INBOX";
	return "Matched by name, not confirmed";
};

interface RoleAppointmentRowProps {
	role: FolderRole;
	folders: readonly CandidateFolder[];
	appointment: RoleAppointment;
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
 *
 * The line under the control says where the row's answer came from, and is
 * pointed at by the Select's `aria-describedby` so the provenance is announced
 * with the control that changes it.
 */
function RoleAppointmentRow({
	role,
	folders,
	appointment,
	displayName,
	onAppoint,
	onRename,
}: RoleAppointmentRowProps) {
	const [draftName, setDraftName] = useState(displayName);
	const selectRef = useRef<HTMLSelectElement>(null);
	const subtitleId = useId();
	const { mailboxId, source, staleFolderPath } = appointment;
	const appointed = folders.find((f) => f.mailboxId === mailboxId) ?? null;
	const label = canonicalRoleLabel(role);
	const renameDirty =
		appointed != null && draftName.trim() !== displayName.trim();

	const subtitle = (() => {
		if (source === "None") {
			const needsOne = role === "trash" ? " Deleting mail needs one." : "";
			return (
				<span id={subtitleId} className="pl-[7.5rem] text-xs text-fg-muted">
					{`Not set — pick the folder this account uses for ${label}.${needsOne}`}
				</span>
			);
		}
		if (source === "Stale" || !appointed) return null;
		return (
			<span
				id={subtitleId}
				className="truncate pl-[7.5rem] text-2xs text-fg-subtle"
				title={appointed.providerPath}
			>
				{`${provenanceClause(source, label)} · ${appointed.providerPath} · ${messages(appointed.messageCount)}`}
			</span>
		);
	})();

	// Trash is the one role where a broken appointment stops a verb; the others
	// fall back to a live folder. With no fallback to name, the sentence stops
	// rather than inventing one.
	const staleFallback =
		role === "trash"
			? " Deleting mail is stopped until you pick another one."
			: appointed
				? ` reader is using ${folderLeaf(
						appointed.providerPath,
						appointed.hierarchyDelimiter,
					)} instead.`
				: "";
	const staleNotice = `The folder you chose for ${label}${
		staleFolderPath ? ` — ${staleFolderPath} —` : ""
	} is gone from the mail server.${staleFallback}`;

	return (
		<div className="flex flex-col gap-1 border-b border-line px-row-inset py-2.5 last:border-b-0">
			<div className="flex items-center gap-2">
				<span className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium text-fg">
					{roleIcon(role)}
					{label}
				</span>
				<Select
					ref={selectRef}
					className="w-56 shrink-0"
					value={mailboxId ?? NONE}
					aria-label={`Folder for ${label}`}
					// Whichever line the row renders — the provenance subtitle or the
					// stale callout — is the one that explains this control.
					aria-describedby={
						subtitle || source === "Stale" ? subtitleId : undefined
					}
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
			{subtitle}
			{source === "Stale" && (
				<Banner tone="warning" variant="soft" className="ml-[7.5rem]">
					<span className="flex flex-wrap items-center gap-2">
						<span id={subtitleId} className="flex-1">
							{staleNotice}
						</span>
						<Button
							variant="secondary"
							size="sm"
							className="shrink-0"
							onClick={() => selectRef.current?.focus()}
						>
							Pick a folder
						</Button>
					</span>
				</Banner>
			)}
		</div>
	);
}

export interface RoleAppointmentListProps {
	accountEmail: string;
	/** Every folder the account exposes (candidates for any role). */
	folders: readonly CandidateFolder[];
	/** role → what fills it and where that answer came from. */
	appointments: Readonly<Record<string, RoleAppointment>>;
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
		Object.values(appointments)
			.map((appointment) => appointment.mailboxId)
			.filter((id): id is string => id != null),
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
					Appointing a folder here removes it from any other role. Each row says
					where its answer came from — your choice, the mail server's own flag,
					or a name reader matched.
				</p>
			</header>
			<div className="rounded-sm border border-line bg-surface">
				{APPOINTABLE_ROLES.map((role) => {
					const appointment = appointments[role] ?? UNRESOLVED;
					return (
						<RoleAppointmentRow
							key={role}
							role={role}
							folders={folders}
							appointment={appointment}
							displayName={
								appointment.mailboxId
									? (displayNames[appointment.mailboxId] ?? "")
									: ""
							}
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
									{folderLeaf(folder.providerPath, folder.hierarchyDelimiter)}
								</span>
								<span className="ml-auto shrink-0 text-2xs text-fg-subtle">
									{messages(folder.messageCount)}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
