import type { ErrorBannerSeverity } from "@/components/ui/error-banners";
import type { BulkRunOutcome } from "@/lib/bulk-actions";
import { type DeleteOutcome, formatNumber } from "@/lib/format";

/** A run ending, as the list banners it. */
export interface RunEndingBanner {
	severity: ErrorBannerSeverity;
	title: string;
	detail?: string;
}

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

/**
 * What the run did, in the past tense. A delete inside Trash expunges rather
 * than moves (#855), and that holds for a run that stopped halfway exactly as
 * it does for one that finished — the half that ran is still erased.
 */
const pastTenseFor = (kind: BulkActionKind, outcome: DeleteOutcome): string =>
	kind === "delete" && outcome === "permanent"
		? "permanently deleted"
		: pastTense[kind];

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
 *
 * A delete inside Trash expunges rather than moves (#855), so the run that just
 * finished is named by its outcome — telling a reader their mail is "moved to
 * Trash" after it was erased is the same lie the confirmation stopped telling,
 * one screen later.
 */
export const bulkActionCompletionText = (
	kind: BulkActionKind,
	done: number,
	outcome: DeleteOutcome = "trash",
): string =>
	`${formatNumber(done)} ${pastTenseFor(kind, outcome)}. Your mail server is still catching up.`;

/**
 * Shown when a run ended before it covered what it was started against. The
 * remainder was never sent, so the mail is where it was and only the user can
 * decide to run it again — which is why this is stated rather than left to a
 * list that quietly stops changing.
 */
export const bulkActionStoppedTitle = (done: number): string =>
	`Stopped after ${formatNumber(done)}`;

export const bulkActionStoppedDetail = (
	kind: BulkActionKind,
	done: number,
	total: number,
	outcome: DeleteOutcome = "trash",
): string =>
	`${formatNumber(done)} of ${formatNumber(total)} ${pastTenseFor(kind, outcome)}. Nothing was sent for the rest, so they are untouched.`;

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

/**
 * How a run that has already ended is announced, or `null` when it announces
 * itself elsewhere.
 *
 * The run screen invites the user to close it and keeps going past that, so by
 * the time a run ends there is often no screen of its own left to say how it
 * went (#521) — the list says it instead. Three endings, and they are not the
 * same news: a run stopped short is a warning, because mail the user asked to
 * be acted on was left untouched; a run that covered everything is a passing
 * note; and a run stopped by a thrown batch already bannered where it threw, so
 * saying it twice is the one wrong answer.
 *
 * Pure, so the severity of each ending is pinned by its result rather than by
 * the shape of the caller that produces it.
 */
export const runEndingBanner = (
	kind: BulkActionKind,
	matched: number,
	outcome: BulkRunOutcome,
	deleteOutcome: DeleteOutcome,
): RunEndingBanner | null => {
	if (outcome.error !== undefined) return null;
	if (outcome.cancelled) {
		return {
			severity: "warning",
			title: bulkActionStoppedTitle(outcome.done),
			detail: bulkActionStoppedDetail(
				kind,
				outcome.done,
				matched,
				deleteOutcome,
			),
		};
	}
	return {
		severity: "info",
		title: bulkActionCompletionText(kind, outcome.done, deleteOutcome),
	};
};
