import type { RunState, StepId } from "@remit/ui";
import type { BulkActionTarget, BulkRunOutcome } from "@/lib/bulk-actions";
import type { OrganizeScope } from "@/lib/organize/organize-model";

export interface RetryContext {
	runState: RunState;
	isEscalated: boolean;
	committedScope: OrganizeScope | undefined;
	createFilterFailed: boolean;
	backApplyPending: boolean;
	widenRunsAsJob: boolean;
	failedIds: readonly string[];
	sent: readonly BulkActionTarget[];
}

export type RetryIntent =
	| { kind: "refreshStatus" }
	| { kind: "rerunEscalated" }
	| { kind: "resetAndResend" }
	| { kind: "resend" }
	| { kind: "startBackApply" }
	| { kind: "waitOnJob" }
	| { kind: "rerunBulk"; targets: readonly BulkActionTarget[] };

/**
 * What pressing the run screen's retry asks for, given where the commit got to.
 *
 * A back-apply whose status could not be read is still running on the server
 * (#526), so that one is decided before anything that could queue a second pass
 * over the same mail.
 */
export const retryIntent = (context: RetryContext): RetryIntent => {
	if (context.runState === "statusUnknown") return { kind: "refreshStatus" };
	// The predicate is re-resolved, not resumed: every verb it carries is
	// idempotent, so the messages the first pass already reached are a no-op.
	if (context.isEscalated) return { kind: "rerunEscalated" };
	if (
		context.committedScope === "standing" ||
		context.committedScope === "temporary"
	) {
		if (context.createFilterFailed) return { kind: "resetAndResend" };
		return context.backApplyPending
			? { kind: "startBackApply" }
			: { kind: "waitOnJob" };
	}
	if (context.committedScope === "all-like-these" && context.widenRunsAsJob) {
		return { kind: "resend" };
	}
	// A run hands back ids, and each one's account came from the batch it was
	// sent in — so a retry re-sends the targets the run was given, filtered to
	// what it never reached.
	const outstanding = new Set(context.failedIds);
	return {
		kind: "rerunBulk",
		targets:
			outstanding.size > 0
				? context.sent.filter((target) => outstanding.has(target.id))
				: context.sent,
	};
};

/**
 * What a commit has left paging. A commit that never started, one whose runner
 * has handed back its outcome, and one that could not start at all all have
 * nothing to end — so the run screen offers no control that would claim to end
 * them (#521).
 */
export const runIsInFlight = (
	bulkRun: { outcome?: BulkRunOutcome; failureReason?: string } | undefined,
): boolean =>
	bulkRun !== undefined &&
	bulkRun.outcome === undefined &&
	bulkRun.failureReason === undefined;

/**
 * Ends the run rather than leaving it. An escalated predicate is paged by the
 * list's own runner and a bounded selection by the wizard's, so the stop has to
 * follow whichever one is paging: a stop that reaches only one of them leaves
 * the other's control on screen doing nothing.
 */
export const stopRunner = (
	escalated: { stop: () => void } | undefined,
	stopBulk: () => void,
): void => {
	if (escalated) {
		escalated.stop();
		return;
	}
	stopBulk();
};

/**
 * Which of the two movements the wizard's exit is, on the step it is taken
 * from. Everywhere but the run screen it rewinds the entries the wizard owns
 * and leaves the selection where it was; on the run screen the action has
 * already been sent, so leaving walks away from a run that keeps going.
 */
export const wizardExit = (
	step: StepId,
	movements: { dismiss: () => void; cancel: () => void },
): (() => void) => (step === "run" ? movements.dismiss : movements.cancel);
