/**
 * The self-update surface, wired to the generated client.
 *
 * A single instance owns the query, the mutation, and the run this page asked
 * for, and hands the folded `SelfUpdateState` plus the blocking-overlay state to
 * every consumer through context — so the Advanced pane, the root overlay, and
 * the nav dot all read one source of truth. The state machine itself lives in
 * `lib/self-update-state.ts`.
 *
 * The held run lives here and nowhere else. A restart does not reload the page,
 * so this state spans the whole window; a page that loads afterwards holds
 * nothing and takes the server's answer as it finds it.
 *
 * Polling follows the run: every 30 seconds while idle, every 5 seconds while a
 * run is in flight or this page is waiting on one it started.
 */
import {
	systemOperationsApplySystemUpdateMutation,
	systemOperationsGetSystemUpdateOptions,
	systemOperationsGetSystemUpdateQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapSystemUpdateResponse,
	RemitImapSystemUpdateRun,
} from "@remit/api-http-client/types.gen.ts";
import type { ReleaseInfo } from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	createElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	appliesSchemaMigration,
	deriveUpdateSurface,
	type HeldRun,
	isSurfaceAbsent,
	mapUpdatePhase,
	releaseFromCheck,
	type UpdateSurface,
} from "@/lib/self-update-state";

const IDLE_POLL_MS = 30_000;
const RUN_POLL_MS = 5_000;

export interface SelfUpdateApi {
	surface: UpdateSurface;
	/** Whether the pending release runs a schema migration during the window. */
	appliesSchemaMigration: boolean;
	currentVersion: string | undefined;
	/** The available release, for the consent dialog. */
	release: ReleaseInfo | undefined;
	/** Refetch the surface, showing a `checking` pane until it settles. */
	onCheck: () => void;
	/** Request a specific release — consent has been given. */
	install: (targetVersion: string) => void;
	/** Clear a finished or given-up result from the pane. */
	onDismissResult: () => void;
	/** Re-poll from the "server never came back" screen. */
	onRetryConnection: () => void;
}

function pollInterval(
	error: unknown,
	run: RemitImapSystemUpdateRun | null,
	hasHeldRun: boolean,
): number | false {
	if (isSurfaceAbsent(error) && !hasHeldRun) return false;
	const inFlight = run !== null && run.outcome === null;
	if (hasHeldRun || inFlight) return RUN_POLL_MS;
	return IDLE_POLL_MS;
}

export function useSystemUpdate(): SelfUpdateApi {
	const queryClient = useQueryClient();
	const [held, setHeld] = useState<HeldRun | null>(null);
	const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
	const [checkRequested, setCheckRequested] = useState(false);

	const heldRef = useRef(held);
	heldRef.current = held;

	const query = useQuery({
		...systemOperationsGetSystemUpdateOptions(),
		retry: false,
		meta: { softError: true },
		refetchInterval: (query) =>
			pollInterval(
				query.state.error,
				query.state.data?.run ?? null,
				heldRef.current !== null,
			),
	});

	const derived = deriveUpdateSurface({
		data: query.data,
		isError: query.isError,
		error: query.error,
		isFetching: query.isFetching,
		held,
		dismissedRunId,
		checkRequested,
		now: Date.now(),
	});

	const shownRunIdRef = useRef<string | null>(null);
	shownRunIdRef.current =
		derived.surface.status === "ready" && "runId" in derived.surface.section
			? derived.surface.section.runId
			: null;

	const { releaseHeld } = derived;

	useEffect(() => {
		if (releaseHeld) setHeld((current) => (current === null ? current : null));
	}, [releaseHeld]);

	useEffect(() => {
		if (checkRequested && !query.isFetching) setCheckRequested(false);
	}, [checkRequested, query.isFetching]);

	const { refetch } = query;

	const onCheck = useCallback(() => {
		setCheckRequested(true);
		void refetch();
	}, [refetch]);

	const onRetryConnection = useCallback(() => {
		void refetch();
	}, [refetch]);

	const mutation = useMutation({
		...systemOperationsApplySystemUpdateMutation(),
		meta: { softError: true },
		onSuccess: (response: RemitImapSystemUpdateResponse) => {
			const run = response.run;
			if (run !== null) {
				setHeld({
					runId: run.runId,
					attemptedVersion: run.targetVersion,
					previousVersion: run.fromVersion,
					phase: mapUpdatePhase(run.phase),
					startedAt: Date.now(),
				});
				setDismissedRunId(null);
			}
			queryClient.setQueryData(
				systemOperationsGetSystemUpdateQueryKey(),
				response,
			);
		},
		onError: () => {
			void refetch();
		},
	});

	const { mutate } = mutation;
	const install = useCallback(
		(targetVersion: string) => {
			mutate({ body: { targetVersion } });
		},
		[mutate],
	);

	const onDismissResult = useCallback(() => {
		if (shownRunIdRef.current !== null)
			setDismissedRunId(shownRunIdRef.current);
		setHeld(null);
	}, []);

	return {
		surface: derived.surface,
		appliesSchemaMigration: appliesSchemaMigration(query.data),
		currentVersion: query.data?.currentVersion,
		release: releaseFromCheck(query.data, Date.now()),
		onCheck,
		install,
		onDismissResult,
		onRetryConnection,
	};
}

const SelfUpdateContext = createContext<SelfUpdateApi | null>(null);

export function SelfUpdateProvider({ children }: { children: ReactNode }) {
	const value = useSystemUpdate();
	return createElement(SelfUpdateContext.Provider, { value }, children);
}

export function useSelfUpdate(): SelfUpdateApi {
	const value = useContext(SelfUpdateContext);
	if (value === null) {
		throw new Error("useSelfUpdate must be used within a SelfUpdateProvider");
	}
	return value;
}

/**
 * The surface when a provider is present, or null when it is not. For the nav
 * dot, which renders in settings trees that some tests mount without the
 * provider — no provider means no update to hint at.
 */
export function useOptionalSelfUpdate(): SelfUpdateApi | null {
	return useContext(SelfUpdateContext);
}
