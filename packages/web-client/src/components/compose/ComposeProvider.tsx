import {
	outboxDetailOperationsGetOutboxMessageOptions,
	outboxOperationsListOutboxMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { isNotFound, softErrorStatuses } from "@/lib/error-classifier";
import type { ReplyMode } from "@/routing";

/**
 * What a composer opened on. The three ways to answer a message are the path
 * segment `$mode` verbatim, so the address and the form say one word each
 * rather than translating between two vocabularies.
 */
export type ComposeMode = ReplyMode | "new";

/**
 * A message on its way out outlives the composer that wrote it: the surface
 * closes on Send and the outbox row is still queued. So the watch sits above
 * every composer, and is the only thing here.
 *
 * Which draft is being written, and whether a composer is on screen at all, are
 * the address's answers — `useComposeDraftId` and `useIsComposing`. A second
 * copy here is what let a reply's draft turn up in the next new message.
 */
interface ComposeContextValue {
	startSendPolling: (outboxMessageId: string) => void;
}

const ComposeContext = createContext<ComposeContextValue | undefined>(
	undefined,
);

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 60_000;

const isSettledStatus = (status: string | undefined): boolean =>
	status === "sent" ||
	status === "unfiled" ||
	status === "failed" ||
	status === "blocked";

/**
 * A send that lands is filed and then forgotten: the worker APPENDs the message
 * to Sent and drops the outbox row, so the row's absence is the settled state
 * and the 404 is the confirmation. `sent` lives for under a second and this poll
 * runs every two, so the 404 is the outcome it normally reads.
 *
 * Only the 404 is this call site's to own. A 401 or a 403 here is a session that
 * lapsed under a send, which the app owes the user an answer about.
 */
export const OUTBOX_ROW_META = softErrorStatuses(404);

/**
 * The watch is over on a settled status and on any error the read comes back
 * with. The 404 is the settled state itself; every other refusal has already
 * escalated once through the query cache, and asking again every two seconds
 * only repeats that escalation — a fresh fatal event per tick — until the cap.
 */
const isWatchOver = (status: string | undefined, error: unknown): boolean =>
	isSettledStatus(status) || error != null;

export const ComposeProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [pollingMessageId, setPollingMessageId] = useState<
		string | undefined
	>();
	const queryClient = useQueryClient();

	const { data: polledMessage, error: pollError } = useQuery({
		...outboxDetailOperationsGetOutboxMessageOptions({
			path: { outboxMessageId: pollingMessageId ?? "" },
		}),
		enabled: !!pollingMessageId,
		meta: OUTBOX_ROW_META,
		retry: (failureCount, error) => !isNotFound(error) && failureCount < 1,
		refetchInterval: (query) => {
			if (isWatchOver(query.state.data?.status, query.state.error))
				return false;
			return POLL_INTERVAL_MS;
		},
	});

	const stopWatching = useCallback(() => {
		setPollingMessageId(undefined);
		queryClient.invalidateQueries({
			queryKey: outboxOperationsListOutboxMessagesQueryKey(),
		});
	}, [queryClient]);

	useEffect(() => {
		if (!pollingMessageId) return;
		if (!isWatchOver(polledMessage?.status, pollError)) return;

		stopWatching();
	}, [polledMessage, pollError, pollingMessageId, stopWatching]);

	// The cap has to put the watch down rather than only stop the interval: a
	// query left enabled comes back on the next window focus, minutes later, to
	// poll a send nobody is waiting on any more.
	useEffect(() => {
		if (!pollingMessageId) return;
		const giveUp = setTimeout(stopWatching, MAX_POLL_DURATION_MS);
		return () => clearTimeout(giveUp);
	}, [pollingMessageId, stopWatching]);

	const startSendPolling = useCallback((outboxMessageId: string) => {
		setPollingMessageId(outboxMessageId);
	}, []);

	const value = useMemo(() => ({ startSendPolling }), [startSendPolling]);

	return (
		<ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>
	);
};

export const useCompose = (): ComposeContextValue => {
	const context = useContext(ComposeContext);
	if (!context) {
		throw new Error("useCompose must be used within a ComposeProvider");
	}
	return context;
};
