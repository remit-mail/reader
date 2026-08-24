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
	useRef,
	useState,
} from "react";
import { getErrorStatus, softErrorMeta } from "@/lib/error-classifier";
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
 */
const isRowGone = (error: unknown): boolean => getErrorStatus(error) === 404;

export const ComposeProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [pollingMessageId, setPollingMessageId] = useState<
		string | undefined
	>();
	const startedAtRef = useRef(0);
	const queryClient = useQueryClient();

	const { data: polledMessage, error: pollError } = useQuery({
		...outboxDetailOperationsGetOutboxMessageOptions({
			path: { outboxMessageId: pollingMessageId ?? "" },
		}),
		enabled: !!pollingMessageId,
		meta: softErrorMeta,
		retry: (failureCount, error) => !isRowGone(error) && failureCount < 1,
		refetchInterval: (query) => {
			if (isSettledStatus(query.state.data?.status)) return false;
			if (isRowGone(query.state.error)) return false;
			if (Date.now() - startedAtRef.current > MAX_POLL_DURATION_MS)
				return false;
			return POLL_INTERVAL_MS;
		},
	});

	useEffect(() => {
		if (!pollingMessageId) return;
		if (!isSettledStatus(polledMessage?.status) && !isRowGone(pollError))
			return;

		setPollingMessageId(undefined);
		queryClient.invalidateQueries({
			queryKey: outboxOperationsListOutboxMessagesQueryKey(),
		});
	}, [polledMessage, pollError, pollingMessageId, queryClient]);

	const startSendPolling = useCallback((outboxMessageId: string) => {
		startedAtRef.current = Date.now();
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
