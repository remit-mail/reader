import {
	configOperationsGetConfigOptions,
	outboxDetailOperationsGetOutboxMessageOptions,
	outboxOperationsListOutboxMessagesQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapDescribeMessageResponse,
} from "@remit/api-http-client/types.gen.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
	createContext,
	startTransition,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useComposeTargetMailboxId } from "@/hooks/useComposeTargetMailbox";
import { hostsComposeSurface } from "@/lib/compose-routes";
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
	const navigate = useNavigate();
	const location = useLocation();
	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});
	const targetMailboxId = useComposeTargetMailboxId(config?.accounts ?? []);

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

	// A compose pressed before the target mailbox has resolved. Held rather than
	// dropped: the press is a request, and a mailbox list a few hundred
	// milliseconds behind the keystroke is not a reason to answer it with
	// nothing. Compose state stays closed until there is a route to mount it.
	const pendingComposeRef = useRef<Omit<ComposeState, "isOpen"> | null>(null);

	const openInTargetMailbox = useCallback(
		(params: Omit<ComposeState, "isOpen">, mailboxId: string) => {
			startTransition(() => {
				setState({ ...params, isOpen: true });
			});
			navigate({ to: "/mail/$mailboxId", params: { mailboxId } });
		},
		[navigate],
	);

	useEffect(() => {
		const pending = pendingComposeRef.current;
		if (!pending || !targetMailboxId) return;
		pendingComposeRef.current = null;
		openInTargetMailbox(pending, targetMailboxId);
	}, [targetMailboxId, openInTargetMailbox]);

	// Opening compose also puts the surface on screen: only a mailbox route
	// mounts `FullCompose`, and only with no thread in the pane it takes over.
	const openCompose = useCallback(
		(params: Omit<ComposeState, "isOpen">) => {
			const search = location.search as Record<string, unknown>;
			const showsThread = Boolean(
				search.selectedMessageId ?? search.selectedThreadId,
			);
			if (!hostsComposeSurface(location.pathname)) {
				if (!targetMailboxId) {
					pendingComposeRef.current = params;
					return;
				}
				openInTargetMailbox(params, targetMailboxId);
				return;
			}
			startTransition(() => {
				setState({ ...params, isOpen: true });
			});
			if (!showsThread) return;
			// A push, so Back reopens the message.
			navigate({
				to: ".",
				search: (prev: Record<string, unknown>) => ({
					...prev,
					selectedMessageId: undefined,
					selectedThreadId: undefined,
				}),
			});
		},
		[
			navigate,
			location.pathname,
			location.search,
			targetMailboxId,
			openInTargetMailbox,
		],
	);

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
