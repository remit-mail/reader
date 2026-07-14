import {
	organizeJobDetailOperationsGetOrganizeJobOptions,
	organizeOperationsCreateOrganizeJobMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapOrganizeJobResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
	buildOrganizeInput,
	type OrganizeDraft,
} from "@/lib/organize/organize-model";
import {
	isTerminalJobState,
	nextPollDelayMs,
} from "@/lib/organize/organize-poll";

export interface OrganizeJobProgress {
	state: RemitImapOrganizeJobResponse["state"] | undefined;
	matchedCount: number;
	appliedCount: number;
	failedCount: number;
	errorMessage: string;
}

/**
 * "All like these" — start a one-time retroactive back-apply (POST /organize)
 * and poll its status to completion (GET /organize/{organizeJobId}). Polling
 * backs off exponentially and stops the instant the job reaches a terminal
 * state (Complete / Failed), surfacing matched / applied / failed counts. The
 * back-apply itself scans the corpus server-side; the client only reads a
 * single job row per poll.
 */
export const useOrganizeJob = (accountId: string | undefined) => {
	const [organizeJobId, setOrganizeJobId] = useState<string | undefined>();

	const createMutation = useMutation({
		...organizeOperationsCreateOrganizeJobMutation(),
		onSuccess: (data) => setOrganizeJobId(data.organizeJobId),
	});
	const { mutate: createJob } = createMutation;

	const jobQuery = useQuery({
		...organizeJobDetailOperationsGetOrganizeJobOptions({
			path: {
				accountId: accountId ?? "",
				organizeJobId: organizeJobId ?? "",
			},
		}),
		enabled: !!accountId && !!organizeJobId,
		refetchInterval: (query) => {
			const state = query.state.data?.state;
			if (isTerminalJobState(state)) return false;
			return nextPollDelayMs(query.state.dataUpdateCount);
		},
	});

	const start = useCallback(
		(draft: OrganizeDraft) => {
			if (!accountId) return;
			setOrganizeJobId(undefined);
			createJob({
				path: { accountId },
				body: buildOrganizeInput(draft),
			});
		},
		[accountId, createJob],
	);

	const job = jobQuery.data;
	const state = job?.state ?? createMutation.data?.state;
	const isDone = isTerminalJobState(job?.state);

	const progress: OrganizeJobProgress = {
		state,
		matchedCount: job?.matchedCount ?? 0,
		appliedCount: job?.appliedCount ?? 0,
		failedCount: job?.failedCount ?? 0,
		errorMessage: job?.errorMessage ?? "",
	};

	return {
		start,
		progress,
		isStarting: createMutation.isPending,
		isRunning: !!organizeJobId && !isDone,
		isDone,
		isError: createMutation.isError || jobQuery.isError,
		error: createMutation.error ?? jobQuery.error,
	};
};
