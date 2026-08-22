import type { RemitImapFolderAppointment } from "@remit/api-http-client/types.gen.ts";

export const MOVE_BATCH_SIZE = 100;

export interface FolderNode {
	mailboxId: string;
	fullPath: string;
	hierarchyDelimiter: string;
	messageCount: number;
	/** RFC 6154 SPECIAL-USE flags, bare (`Trash`, not `\Trash`). */
	specialUse?: readonly string[];
}

/** Where a role's answer came from. */
export type RoleAppointmentSource = RemitImapFolderAppointment["source"];

export interface RoleAppointment {
	role: string;
	source: RoleAppointmentSource;
	mailboxId?: string | null;
}

export type DeleteBlockReason = "inbox" | "role" | "children";

export interface DeleteGuard {
	deletable: boolean;
	reason?: DeleteBlockReason;
	message?: string;
}

const isInboxPath = (fullPath: string): boolean =>
	fullPath.trim().toLowerCase() === "inbox";

/**
 * A folder has children when another mailbox's path is nested under it — the
 * folder's own path followed by the hierarchy delimiter. The delimiter matters:
 * `Work` is not a parent of `Workshop`, only of `Work/Shop`.
 */
export const hasChildFolders = (
	folder: Pick<FolderNode, "mailboxId" | "fullPath" | "hierarchyDelimiter">,
	all: readonly Pick<FolderNode, "mailboxId" | "fullPath">[],
): boolean => {
	const prefix = `${folder.fullPath}${folder.hierarchyDelimiter}`;
	return all.some(
		(other) =>
			other.mailboxId !== folder.mailboxId && other.fullPath.startsWith(prefix),
	);
};

/**
 * Sources that vouch for the mailbox they name: a person chose it, or the
 * server flagged it. `Proposed` is a guess at a folder's name and vouches for
 * nothing. `Reserved` is unreachable behind the inbox branch below and stays
 * anyway — this set is a statement about evidence, not about branch order.
 */
const VOUCHED_SOURCES: readonly RoleAppointmentSource[] = [
	"Appointed",
	"Flagged",
	"Reserved",
];

/**
 * A `Stale` entry resolves to whatever the account would have had with no
 * appointment at all, and that fallback can be the folder the server itself
 * flags for the role. The entry no longer carries which it was, so read the
 * flag off the folder: the mail server's designation is unchanged by the
 * user's own choice going missing, and nothing behind this guard re-checks it.
 * Flag values are the bare RFC 6154 names, identical to the canonical roles.
 */
const vouchesFor = (
	appointment: RoleAppointment,
	folder: Pick<FolderNode, "mailboxId" | "specialUse">,
): boolean => {
	if (appointment.mailboxId !== folder.mailboxId) return false;
	if (appointment.source === "Stale")
		return folder.specialUse?.includes(appointment.role) ?? false;
	return VOUCHED_SOURCES.includes(appointment.source);
};

/** The canonical role a folder is vouched for, or `undefined` when none is. */
export const vouchedRole = (
	folder: Pick<FolderNode, "mailboxId" | "specialUse">,
	appointments: readonly RoleAppointment[],
): string | undefined => appointments.find((a) => vouchesFor(a, folder))?.role;

/**
 * Why a folder can't be deleted, or `{ deletable: true }` when it can. The
 * inbox is reserved, a folder somebody vouched for in a canonical role must be
 * released first, and a folder with subfolders must have them handled before it
 * goes. A role a folder only fills because its name reads that way is no reason
 * to keep the folder: the message would name a remedy that does not apply.
 */
export function guardFolderDeletion(
	folder: FolderNode,
	all: readonly FolderNode[],
	appointments: readonly RoleAppointment[],
): DeleteGuard {
	if (isInboxPath(folder.fullPath))
		return {
			deletable: false,
			reason: "inbox",
			message: "The inbox can't be deleted.",
		};

	const role = vouchedRole(folder, appointments);
	if (role)
		return {
			deletable: false,
			reason: "role",
			message: `This folder is your ${role} folder. Reassign that role before deleting it.`,
		};

	if (hasChildFolders(folder, all))
		return {
			deletable: false,
			reason: "children",
			message: "This folder has subfolders. Delete them first.",
		};

	return { deletable: true };
}

/** Destinations with the folder being deleted removed. */
export function excludeFolder<T extends { mailboxId: string }>(
	targets: readonly T[],
	excludeMailboxId: string,
): T[] {
	return targets.filter((target) => target.mailboxId !== excludeMailboxId);
}

export type MovePhase = "moving" | "moved" | "failed";

export interface MoveProgress {
	total: number;
	moved: number;
	phase: MovePhase;
	error?: string;
}

/** Progress at the start of a move; an empty set is already `moved`. */
export function beginMove(total: number): MoveProgress {
	return { total, moved: 0, phase: total === 0 ? "moved" : "moving" };
}

/**
 * Count a successful batch. Clamps to `total` so a folder that grew mid-move
 * never shows more moved than started, and only a still-`moving` progress
 * advances — a failed or finished move stays put.
 */
export function advanceMove(
	progress: MoveProgress,
	batchSize: number,
): MoveProgress {
	if (progress.phase !== "moving") return progress;
	const moved = Math.min(
		progress.total,
		progress.moved + Math.max(0, batchSize),
	);
	return {
		...progress,
		moved,
		phase: moved >= progress.total ? "moved" : "moving",
	};
}

/** A failed batch stops progress and surfaces the error; nothing advances after. */
export function failMove(progress: MoveProgress, error: string): MoveProgress {
	return { ...progress, phase: "failed", error };
}

export function moveProgressLabel(progress: MoveProgress): string {
	return `Moved ${progress.moved} of ${progress.total}`;
}

/** How long a wait has run, as `m:ss` — clamped at zero so a clock skew reads as 0:00. */
export function elapsedLabel(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Where the wizard opens: a straight confirm for an empty folder, otherwise the fate step. */
export function initialStage(
	messageCount: number,
): "confirm-empty" | "choose-fate" {
	return messageCount > 0 ? "choose-fate" : "confirm-empty";
}
