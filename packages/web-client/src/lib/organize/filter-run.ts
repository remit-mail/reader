import type {
	OrganizeJobFailure,
	OrganizeJobProgress,
} from "@/hooks/useOrganizeJob";

/** Where a Run now stands, as the filter's row says it. */
export type FilterRunStatus =
	| { kind: "queuing" }
	| { kind: "running" }
	| { kind: "done"; matched: number; applied: number }
	| { kind: "failed"; error: unknown };

export interface FilterRunReading {
	progress: OrganizeJobProgress;
	failure: OrganizeJobFailure | undefined;
	isStarting: boolean;
	isRunning: boolean;
	isDone: boolean;
}

/**
 * The row's status for the job a Run now started. A job the worker failed —
 * a filter turned off since, or deleted — is a failure like a refused start,
 * never a lingering "running".
 */
export const filterRunStatus = (
	reading: FilterRunReading,
): FilterRunStatus | undefined => {
	if (reading.failure) return { kind: "failed", error: reading.failure.error };
	if (reading.isStarting) return { kind: "queuing" };
	if (reading.isDone) {
		if (reading.progress.state === "Failed") {
			return {
				kind: "failed",
				error: new Error(
					reading.progress.errorMessage || "The run over the inbox failed.",
				),
			};
		}
		return {
			kind: "done",
			matched: reading.progress.matchedCount,
			applied: reading.progress.appliedCount,
		};
	}
	if (reading.isRunning) return { kind: "running" };
	return undefined;
};
