import { mailboxOperationsListMailboxesQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { buildMutationErrorBanner } from "@/components/ui/error-banners";
import { isFolderRoleRefusal } from "@/components/ui/folder-role-refusal";
import {
	bulkActionFailureDetail,
	bulkActionFailureTitle,
	bulkRunBusyRefusal,
} from "@/lib/bulk-action-copy";
import {
	type ApplyBatch,
	type BulkActionProgress,
	type BulkActionTarget,
	type BulkRunOutcome,
	type BulkRunStart,
	type EscalatedAction,
	type FetchIdsPage,
	honestProgress,
	mailboxesTouchedBy,
	runChunkedAction,
	runPredicateAction,
} from "@/lib/bulk-actions";
import {
	invalidateThreadListQueries,
	threadListCacheKeys,
} from "@/lib/thread-list-cache";
import { useRoleAppointmentPrompt } from "./RoleAppointmentPromptProvider";

/**
 * What the run pages, which is the one thing a bounded and an escalated run do
 * differently: a ticked selection is a list of ids the surface already holds,
 * an escalated one is a predicate the server re-resolves page by page.
 */
export type BulkRunSource =
	| { kind: "targets"; targets: readonly BulkActionTarget[] }
	| { kind: "predicate"; fetchPage: FetchIdsPage };

export interface BulkRunRequest {
	action: EscalatedAction;
	/** The mailbox the run belongs to — where its progress shows on return. */
	mailboxId: string;
	/** That mailbox in the user's words, for a refusal that names this run. */
	mailboxLabel?: string;
	/** Owning account, for the unseen-count invalidation on completion. */
	accountId: string | undefined;
	/** The count the run was offered against, for the bar and for the ending. */
	matched: number;
	source: BulkRunSource;
	/** Issues one batch of the action. Closed over the SDK, never over a screen. */
	applyBatch: ApplyBatch;
	/**
	 * States how the run ended, once no screen is left reporting on it in place.
	 * Called by the provider rather than by the caller, so an ending that lands
	 * after the surface unmounted is still said out loud (#112). Absent on a
	 * surface with nowhere to say it.
	 */
	reportEnding?: (
		kind: EscalatedAction["kind"],
		matched: number,
		outcome: BulkRunOutcome,
	) => void;
	/**
	 * Handed the release for this run's ending, for a screen that is showing the
	 * ending itself. The claim is made inside `start`, for the run it starts, so
	 * a commit that starts no run holds nothing over the ending of one that is
	 * already going (#112). Released when that screen goes.
	 */
	claimEnding?: (release: () => void) => void;
}

/** A run in flight, as any screen reads it. */
export interface ActiveBulkRun {
	action: EscalatedAction;
	mailboxId: string;
	/** Seeded from the count the run was offered against, so the bar has a
	 *  denominator before the first batch comes back. */
	progress: BulkActionProgress;
}

interface BulkRunContextValue {
	run: ActiveBulkRun | undefined;
	/**
	 * Runs `request`, or refuses it because one is already going. There is one
	 * slot: a second run would page behind the first's bar and answer to the
	 * first's Stop, so it is refused with the run in flight named rather than
	 * queued or started alongside.
	 */
	start: (request: BulkRunRequest) => Promise<BulkRunStart>;
	/**
	 * Ends the run `mailboxId` owns: the request on the wire is aborted and
	 * nothing more leaves. A stop aimed at any other mailbox is not this run's,
	 * and reaches nothing.
	 */
	stop: (mailboxId: string) => void;
}

const BulkRunContext = createContext<BulkRunContextValue | undefined>(
	undefined,
);

/**
 * The owner of a chunked bulk run (#112).
 *
 * A run is mail leaving the mailbox, and it outlives every screen that can show
 * it: the wizard invites the user to close it mid-run, and nothing stops them
 * navigating to another mailbox on top of that. Held in the surface that started
 * it, the progress, the count and the cancellation all unmounted with the route,
 * so returning showed nothing, Stop reached nothing, and an ending that landed
 * after the move was dropped in silence.
 *
 * Mounted at the root beside the other app-lifetime providers, this holds the
 * run instead: its progress, its `AbortController`, the caches it invalidates,
 * the refusal it replays and the ending it states. A screen reads the run and
 * offers Stop; it never owns either.
 *
 * In memory and per tab. A run is a sequence of requests this tab is making, so
 * a reload ends it — persisting the reading would show a bar for a run nothing
 * is driving.
 */
export const BulkRunProvider = ({ children }: { children: ReactNode }) => {
	const [run, setRun] = useState<ActiveBulkRun | undefined>(undefined);
	// The signal every call of the live run is issued under, so a stop ends the
	// request on the wire instead of waiting for it to come back (#113).
	const controllerRef = useRef<AbortController | undefined>(undefined);
	// Identifies the live run across the awaits below, so a run that ended after
	// the slot was taken from it — by a sign-out — writes nothing back.
	const liveRunRef = useRef<symbol | undefined>(undefined);
	// What is in the slot, read synchronously: two commits landing in one frame
	// both have to see the first of them.
	const liveRequestRef = useRef<BulkRunRequest | undefined>(undefined);
	// The runs a screen is reporting on in place, by token — never a count of
	// claims over runs in general, which any commit could hold against any run.
	const claimsRef = useRef(new Set<symbol>());
	const queryClient = useQueryClient();
	const { pushError } = useErrorBanners();
	const { requestAppointment } = useRoleAppointmentPrompt();
	// The run replays itself once a folder is appointed, so it needs a handle on
	// itself that does not make `start` its own dependency.
	const startRef = useRef<BulkRunContextValue["start"]>(async () => ({
		kind: "ran",
		outcome: { done: 0, failedIds: [], cancelled: false },
	}));

	/**
	 * The listings a run changed, and the unseen counts it moved. A cross-account
	 * selection has no single owning account, so the run's own targets name the
	 * accounts to refresh alongside the one the surface named.
	 */
	const invalidateAfterRun = useCallback(
		(request: BulkRunRequest) => {
			invalidateThreadListQueries(
				queryClient,
				threadListCacheKeys(
					mailboxesTouchedBy(request.action, request.mailboxId),
				),
			);
			const touched = new Set<string>();
			if (request.accountId) touched.add(request.accountId);
			if (request.source.kind === "targets") {
				for (const target of request.source.targets) {
					if (target.accountId) touched.add(target.accountId);
				}
			}
			for (const accountId of touched) {
				queryClient.invalidateQueries({
					queryKey: mailboxOperationsListMailboxesQueryKey({
						path: { accountId },
					}),
				});
			}
		},
		[queryClient],
	);

	const start = useCallback(
		async (request: BulkRunRequest): Promise<BulkRunStart> => {
			const inFlight = liveRequestRef.current;
			if (inFlight) {
				return {
					kind: "refused",
					reason: bulkRunBusyRefusal(
						inFlight.action.kind,
						inFlight.matched,
						inFlight.mailboxLabel,
					),
				};
			}
			const token = Symbol("bulk-run");
			const controller = new AbortController();
			controllerRef.current = controller;
			liveRunRef.current = token;
			liveRequestRef.current = request;
			if (request.claimEnding) {
				claimsRef.current.add(token);
				request.claimEnding(() => claimsRef.current.delete(token));
			}
			setRun({
				action: request.action,
				mailboxId: request.mailboxId,
				progress: { done: 0, total: request.matched },
			});
			// `honestProgress` widens `total` if `done` overtakes it (#109) — the
			// predicate can match more by the time the run pages it than the count
			// saw, and the bar must never show more done than out of.
			const onProgress = (next: BulkActionProgress) => {
				if (liveRunRef.current !== token) return;
				setRun((held) =>
					held ? { ...held, progress: honestProgress(next) } : held,
				);
			};

			const outcome =
				request.source.kind === "targets"
					? await runChunkedAction(
							request.source.targets,
							request.applyBatch,
							onProgress,
							controller.signal,
						)
					: await runPredicateAction(
							request.source.fetchPage,
							request.matched,
							request.applyBatch,
							onProgress,
							controller.signal,
						);

			const reportedInPlace = claimsRef.current.delete(token);
			if (liveRunRef.current === token) {
				liveRunRef.current = undefined;
				liveRequestRef.current = undefined;
				setRun(undefined);
			}

			// A provenance refusal is answered by the appointment prompt exactly as
			// it is on the single-row path (#887, #876). Left to the banner it
			// arrives as the API's own sentence — "Appoint one under Settings ›
			// Folder roles" — which asks the user to reassemble a select-all they
			// have already made.
			const refusal = outcome.error
				? isFolderRoleRefusal(outcome.error)
				: undefined;
			if (refusal) {
				requestAppointment({
					accountId: refusal.accountId,
					role: refusal.role,
					reason: refusal.reason,
					action: { kind: "delete", count: request.matched },
					// The replay is a new run, and it claims nothing: the claim the
					// original was started under belongs to a screen whose release has
					// already fired or never will for this run, so re-claiming would
					// leave the replay's ending held back by nobody and never said.
					onAppointed: async () => {
						const replayed = await startRef.current({
							...request,
							claimEnding: undefined,
						});
						if (replayed.kind === "refused") {
							pushError({
								title: bulkActionFailureTitle(request.action.kind, 0),
								detail: replayed.reason,
							});
						}
					},
				});
			} else if (outcome.error) {
				pushError(
					buildMutationErrorBanner(
						bulkActionFailureTitle(request.action.kind, outcome.done),
						bulkActionFailureDetail(request.action.kind),
						outcome.error,
					),
				);
			}
			// Nobody is left showing this run, so the ending is said where the user
			// now is. A screen still reporting on it says it in place instead.
			if (!reportedInPlace) {
				request.reportEnding?.(request.action.kind, request.matched, outcome);
			}
			if (outcome.done > 0) invalidateAfterRun(request);
			return { kind: "ran", outcome };
		},
		[invalidateAfterRun, pushError, requestAppointment],
	);
	startRef.current = start;

	const stop = useCallback((mailboxId: string) => {
		if (liveRequestRef.current?.mailboxId !== mailboxId) return;
		controllerRef.current?.abort();
	}, []);

	// A run belongs to the session that started it. Both auth shells gate the
	// whole app on the session, so signing out or switching accounts takes this
	// provider down with the router — and a run left paging past that would go on
	// deleting mail for an account nobody is signed in to.
	useEffect(() => {
		const claims = claimsRef.current;
		return () => {
			controllerRef.current?.abort();
			controllerRef.current = undefined;
			liveRunRef.current = undefined;
			liveRequestRef.current = undefined;
			claims.clear();
		};
	}, []);

	const value = useMemo(() => ({ run, start, stop }), [run, start, stop]);

	return (
		<BulkRunContext.Provider value={value}>{children}</BulkRunContext.Provider>
	);
};

export const useBulkRun = (): BulkRunContextValue => {
	const context = useContext(BulkRunContext);
	if (!context) {
		throw new Error("useBulkRun must be used within a BulkRunProvider");
	}
	return context;
};
