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
 * Why the job is not reporting, which is three separate facts (#526, #552). A
 * create that never returned an id means nothing was started; the same create
 * over a pass that already ran means that pass stands and only the retry never
 * left; a status read that failed means a job is out there and this client
 * cannot see how far it got.
 */
export interface OrganizeJobFailure {
	kind: "startFailed" | "restartFailed" | "statusUnreadable";
	error: unknown;
}

const organizeJobFailure = (
	createError: unknown,
	statusError: unknown,
	passAlreadyRun: boolean,
): OrganizeJobFailure | undefined => {
	if (createError) {
		return {
			kind: passAlreadyRun ? "restartFailed" : "startFailed",
			error: createError,
		};
	}
	if (statusError) return { kind: "statusUnreadable", error: statusError };
	return undefined;
};

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
			createJob({
				path: { accountId },
				body: buildOrganizeInput(draft),
			});
		},
		[accountId, createJob],
	);

	const { refetch } = jobQuery;
	// Looks at the job already in flight again. Distinct from `start`, which
	// queues a second pass over the same mail.
	const refreshStatus = useCallback(() => {
		void refetch();
	}, [refetch]);

	// The last pass this client read. A restart replaces it only once the server
	// hands back a job id: while the create is in flight those counts are not this
	// pass's, and a create that fails leaves them standing (#552).
	const lastPass = jobQuery.data;
	const job = createMutation.isPending ? undefined : lastPass;
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
		refreshStatus,
		progress,
		isStarting: createMutation.isPending,
		isRunning: !!organizeJobId && !isDone,
		isDone,
		failure: organizeJobFailure(
			createMutation.error,
			jobQuery.error,
			!!lastPass,
		),
	};
};
