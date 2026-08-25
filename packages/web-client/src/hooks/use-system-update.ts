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
 * run is in flight, this page is waiting on one it started, or it is waiting on
 * a check it pressed for.
 */
import {
	systemOperationsApplySystemUpdateMutation,
	systemOperationsGetSystemUpdateOptions,
	systemOperationsGetSystemUpdateQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { systemOperationsGetSystemUpdate } from "@remit/api-http-client/sdk.gen.ts";
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
import { shouldEscalate, softErrorMeta } from "@/lib/error-classifier";
import { reportFatalError } from "@/lib/fatal-error";
import {
	appliesSchemaMigration,
	type CheckPress,
	checkAnswered,
	checkRequestFailureReason,
	deriveUpdateSurface,
	type HeldRun,
	isSurfaceAbsent,
	mapUpdatePhase,
	releaseFromCheck,
	type UpdateSurface,
} from "@/lib/self-update-state";

const IDLE_POLL_MS = 30_000;
const RUN_POLL_MS = 5_000;

/**
 * How long a pressed check waits for the updater before the pane calls it a
 * failure. The backend only records the request; the updater picks it up on a
 * five-second watch tick, so half a minute is several ticks — patient enough for
 * a busy box, short enough that a press against a dead updater is answered
 * rather than left spinning for good.
 */
export const CHECK_ANSWER_BUDGET_MS = 30_000;

/** The press was recorded and nothing came back. Names the process and the log. */
export const UPDATER_SILENT_REASON =
	"The updater did not answer. Run `remit logs updater` to see why.";

export interface SelfUpdateApi {
	surface: UpdateSurface;
	/** Whether the pending release runs a schema migration during the window. */
	appliesSchemaMigration: boolean;
	currentVersion: string | undefined;
	/** The available release, for the consent dialog. */
	release: ReleaseInfo | undefined;
	/** Ask the updater for a fresh check, showing a `checking` pane until it answers. */
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
	hasPress: boolean,
): number | false {
	if (isSurfaceAbsent(error) && !hasHeldRun) return false;
	const inFlight = run !== null && run.outcome === null;
	// A press is waiting on the updater's next watch tick (#599), so it polls at
	// the run cadence — and only until the wait ends, which drops the press.
	if (hasHeldRun || inFlight || hasPress) return RUN_POLL_MS;
	return IDLE_POLL_MS;
}

export function useSystemUpdate(): SelfUpdateApi {
	const queryClient = useQueryClient();
	const [held, setHeld] = useState<HeldRun | null>(null);
	const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
	const [checkPress, setCheckPress] = useState<CheckPress | null>(null);
	const [checkFailure, setCheckFailure] = useState<string | null>(null);

	const heldRef = useRef(held);
	heldRef.current = held;
	const pressRef = useRef(checkPress);
	pressRef.current = checkPress;

	const query = useQuery({
		...systemOperationsGetSystemUpdateOptions(),
		retry: false,
		meta: { softError: true },
		refetchInterval: (query) =>
			pollInterval(
				query.state.error,
				query.state.data?.run ?? null,
				heldRef.current !== null,
				pressRef.current !== null,
			),
	});

	const dataRef = useRef(query.data);
	dataRef.current = query.data;

	const derived = deriveUpdateSurface({
		data: query.data,
		isError: query.isError,
		error: query.error,
		held,
		dismissedRunId,
		checkPress,
		checkFailure,
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

	// The updater answered the press: let go of it, so the next poll renders the
	// verdict rather than the spinner.
	useEffect(() => {
		if (checkPress !== null && checkAnswered(checkPress, query.data))
			setCheckPress(null);
	}, [checkPress, query.data]);

	// The wait has to end itself. A poll that answers with the same bytes changes
	// nothing this hook reads, so nothing would re-render to notice the budget had
	// run out, and the spinner would sit there for good (#599).
	useEffect(() => {
		if (checkPress === null) return;
		const remaining =
			checkPress.pressedAt + CHECK_ANSWER_BUDGET_MS - Date.now();
		const timer = setTimeout(
			() => {
				setCheckPress(null);
				setCheckFailure(UPDATER_SILENT_REASON);
			},
			Math.max(0, remaining),
		);
		return () => clearTimeout(timer);
	}, [checkPress]);

	const { refetch } = query;

	const onCheck = useCallback(() => {
		// A plain refetch only re-reads state.json, so the answer would be exactly
		// as old as it was before the press. refresh=true has the backend record a
		// check request for the updater; the wait is this page's to keep, against
		// the `lastCheckedAt` the server had when the control was pressed (#599).
		setCheckFailure(null);
		setCheckPress({
			pressedAt: Date.now(),
			since: dataRef.current?.check.lastCheckedAt,
		});

		void systemOperationsGetSystemUpdate({
			query: { refresh: true },
			throwOnError: true,
		})
			.then(() => {
				void refetch();
			})
			.catch((error: unknown) => {
				// The request never reached the seam, so nothing is coming. Say so
				// where the press was made instead of reverting to the old verdict.
				// This is a raw SDK call, outside the query cache that feeds the
				// global sink, so the 5xx the seam answers when the control volume
				// is unwritable escalates from here or from nowhere.
				if (shouldEscalate(error, softErrorMeta, "user")) {
					reportFatalError(error);
				}
				setCheckPress(null);
				setCheckFailure(checkRequestFailureReason(error));
			});
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
