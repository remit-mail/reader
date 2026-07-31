import type { RunState } from "@remit/ui";
import type { OrganizeJobFailure } from "@/hooks/useOrganizeJob";

/** What the run screen knows about a back-apply job it is reporting on. */
export interface OrganizeJobReading {
	failure: OrganizeJobFailure | undefined;
	isStarting: boolean;
	isRunning: boolean;
	isDone: boolean;
	failedCount: number;
	/**
	 * The pass belongs to a rule that already saved, so a pass that never started
	 * leaves the rule standing rather than leaving nothing behind.
	 */
	ruleSaved: boolean;
}

/**
 * What the run screen says the job is doing. A status that could not be read is
 * not a job that never started (#526), so what the job is doing is read before
 * what failed: a dropped poll leaves a running pass running and a finished one
 * finished, and only a create that never returned an id says nothing happened.
 */
export const organizeRunState = ({
	failure,
	isStarting,
	isRunning,
	isDone,
	failedCount,
	ruleSaved,
}: OrganizeJobReading): RunState => {
	if (failure?.kind === "startFailed") {
		return ruleSaved ? "backApplyStartFailed" : "commitFailed";
	}
	if (isDone) return failedCount > 0 ? "backApplyFailed" : "backApplyComplete";
	if (failure?.kind === "statusUnreadable") return "statusUnknown";
	if (isStarting || isRunning) return "backApplyRunning";
	return "saving";
};
