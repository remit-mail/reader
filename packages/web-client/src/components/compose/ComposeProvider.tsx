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

export type ComposeMode = "reply" | "reply_all" | "forward" | "new";

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

	const { data: polledMessage } = useQuery({
		...outboxDetailOperationsGetOutboxMessageOptions({
			path: { outboxMessageId: pollingMessageId ?? "" },
		}),
		enabled: !!pollingMessageId,
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (status === "sent" || status === "failed" || status === "blocked")
				return false;
			if (Date.now() - startedAtRef.current > MAX_POLL_DURATION_MS)
				return false;
			return POLL_INTERVAL_MS;
		},
	});

	useEffect(() => {
		if (!polledMessage || !pollingMessageId) return;

		const terminal =
			polledMessage.status === "sent" ||
			polledMessage.status === "failed" ||
			polledMessage.status === "blocked";

		if (terminal) {
			setPollingMessageId(undefined);
			queryClient.invalidateQueries({
				queryKey: outboxOperationsListOutboxMessagesQueryKey(),
			});
		}
	}, [polledMessage, pollingMessageId, queryClient]);

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
