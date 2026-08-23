import type { RunState } from "@remit/ui";
import type { BulkActionTarget } from "@/lib/bulk-actions";
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
