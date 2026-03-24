import {
	outboxDetailOperationsGetOutboxMessageOptions,
	outboxOperationsListOutboxMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
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

export interface ComposeState {
	isOpen: boolean;
	mode: ComposeMode;
	account?: RemitImapAccountResponse;
	sourceMessage?: RemitImapDescribeMessageResponse;
	threadId?: string;
	mailboxId?: string;
	outboxMessageId?: string;
}

interface ComposeContextValue {
	state: ComposeState;
	openCompose: (params: Omit<ComposeState, "isOpen">) => void;
	closeCompose: () => void;
	setOutboxMessageId: (id: string) => void;
	startSendPolling: (outboxMessageId: string) => void;
}

const ComposeContext = createContext<ComposeContextValue | undefined>(
	undefined,
);

const INITIAL_STATE: ComposeState = {
	isOpen: false,
	mode: "new",
};

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_DURATION_MS = 60_000;

export const ComposeProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const [state, setState] = useState<ComposeState>(INITIAL_STATE);
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
			if (status === "sent" || status === "failed") return false;
			if (Date.now() - startedAtRef.current > MAX_POLL_DURATION_MS)
				return false;
			return POLL_INTERVAL_MS;
		},
	});

	useEffect(() => {
		if (!polledMessage || !pollingMessageId) return;

		if (polledMessage.status === "sent") {
			setPollingMessageId(undefined);
			queryClient.invalidateQueries({
				queryKey: outboxOperationsListOutboxMessagesQueryKey(),
			});
		}

		if (polledMessage.status === "failed") {
			setPollingMessageId(undefined);
			queryClient.invalidateQueries({
				queryKey: outboxOperationsListOutboxMessagesQueryKey(),
			});
		}
	}, [polledMessage, pollingMessageId, queryClient]);

	const openCompose = useCallback((params: Omit<ComposeState, "isOpen">) => {
		setState({ ...params, isOpen: true });
	}, []);

	const closeCompose = useCallback(() => {
		setState(INITIAL_STATE);
	}, []);

	const setOutboxMessageId = useCallback((id: string) => {
		setState((prev) => ({ ...prev, outboxMessageId: id }));
	}, []);

	const startSendPolling = useCallback((outboxMessageId: string) => {
		startedAtRef.current = Date.now();
		setPollingMessageId(outboxMessageId);
	}, []);

	const value = useMemo(
		() => ({
			state,
			openCompose,
			closeCompose,
			setOutboxMessageId,
			startSendPolling,
		}),
		[state, openCompose, closeCompose, setOutboxMessageId, startSendPolling],
	);

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
