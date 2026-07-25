export const MOVE_BATCH_SIZE = 100;

export interface FolderNode {
	mailboxId: string;
	fullPath: string;
	hierarchyDelimiter: string;
	messageCount: number;
}

export interface RoleAppointment {
	role: string;
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

/** The canonical role a mailbox is appointed to, or `undefined` when unfilled. */
export const appointedRole = (
	mailboxId: string,
	appointments: readonly RoleAppointment[],
): string | undefined =>
	appointments.find((a) => a.mailboxId != null && a.mailboxId === mailboxId)
		?.role;

/**
 * Why a folder can't be deleted, or `{ deletable: true }` when it can. The
 * inbox is reserved, a folder that fills a canonical role must be released
 * first, and a folder with subfolders must have them handled before it goes.
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

	const role = appointedRole(folder.mailboxId, appointments);
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

/** Split ids into fixed-size batches; the API moves at most 100 per call. */
export function chunkIds(
	ids: readonly string[],
	size: number = MOVE_BATCH_SIZE,
): string[][] {
	if (size <= 0) throw new Error("chunk size must be positive");
	const batches: string[][] = [];
	for (let i = 0; i < ids.length; i += size) {
		batches.push(ids.slice(i, i + size));
	}
	return batches;
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

export type DeleteStage =
	| "confirm-empty"
	| "choose-fate"
	| "confirm-delete-all"
	| "pick-destination"
	| "moving"
	| "deleting"
	| "error";

/** Where the wizard opens: a straight confirm for an empty folder, otherwise the fate step. */
export function initialStage(
	messageCount: number,
): "confirm-empty" | "choose-fate" {
	return messageCount > 0 ? "choose-fate" : "confirm-empty";
}
