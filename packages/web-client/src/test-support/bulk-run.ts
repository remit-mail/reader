import type { BulkRunOutcome, BulkRunStart } from "../lib/bulk-actions";

/**
 * The outcome of a run a test meant to start. A refusal here is the test's own
 * setup — another run of its making is still going — so it says so rather than
 * failing on a missing property three assertions later.
 */
export const ranOutcome = (started: BulkRunStart): BulkRunOutcome => {
	if (started.kind === "refused") {
		throw new Error(`the run was refused: ${started.reason}`);
	}
	return started.outcome;
};
