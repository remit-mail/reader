import { formatNumber } from "@/lib/format";

/**
 * Wording for the three bulk actions a selection can run (#114). One place
 * per sentence the selection bar, the completion banner and the error banner
 * can say, so a new action is a row in these tables rather than a branch in
 * every caller.
 */
export type BulkActionKind = "delete" | "move" | "markRead";

const progressPhrase: Record<
	BulkActionKind,
	(done: string, total: string) => string
> = {
	delete: (done, total) => `Deleting ${done} of ${total}…`,
	move: (done, total) => `Moving ${done} of ${total}…`,
	markRead: (done, total) => `Marking ${done} of ${total} as read…`,
};

const pastTense: Record<BulkActionKind, string> = {
	delete: "moved to Trash",
	move: "moved",
	markRead: "marked as read",
};

const negated: Record<BulkActionKind, string> = {
	delete: "couldn't be deleted",
	move: "couldn't be moved",
	markRead: "couldn't be marked as read",
};

const failureTitle: Record<BulkActionKind, string> = {
	delete: "Couldn't delete these messages",
	move: "Couldn't move these messages",
	markRead: "Couldn't mark these messages as read",
};

const failureDetail: Record<BulkActionKind, string> = {
	delete: "The delete didn't finish.",
	move: "The move didn't finish.",
	markRead: "The update didn't finish.",
};

/** Running status while a chunked or escalated run is in flight. */
export const bulkActionProgressLabel = (
	kind: BulkActionKind,
	done: number,
	total: number,
): string => progressPhrase[kind](formatNumber(done), formatNumber(total));

/**
 * Shown once a run finishes with nothing left over. The second sentence is
 * the honest part: the bulk endpoints enqueue the IMAP write, so the mail
 * server is still applying it when this appears.
 */
export const bulkActionCompletionText = (
	kind: BulkActionKind,
	done: number,
): string =>
	`${formatNumber(done)} ${pastTense[kind]}. Your mail server is still catching up.`;

/** Shown when part of a run landed and the rest is still selected for Retry. */
export const bulkActionPartialText = (
	kind: BulkActionKind,
	succeeded: number,
	remaining: number,
): string =>
	`${formatNumber(succeeded)} ${pastTense[kind]}. ${formatNumber(remaining)} ${negated[kind]}.`;

/** Error-banner title for a run stopped by an infrastructure failure. */
export const bulkActionFailureTitle = (
	kind: BulkActionKind,
	done: number,
): string =>
	done > 0
		? `Stopped after ${formatNumber(done)} — some messages ${negated[kind]}`
		: failureTitle[kind];

export const bulkActionFailureDetail = (kind: BulkActionKind): string =>
	failureDetail[kind];

/** Progress-bar tone: only delete is destructive. */
export const bulkActionProgressTone = (
	kind: BulkActionKind,
): "danger" | "info" => (kind === "delete" ? "danger" : "info");
