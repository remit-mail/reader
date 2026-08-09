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
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useErrorBanners } from "@/components/ui/ErrorBannerProvider";
import { useComposeTarget } from "@/hooks/useComposeTargetMailbox";
import { hostsComposeSurface } from "@/lib/compose-routes";
import { locationOpensDetail } from "@/lib/mail-route";
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
	const routeParams = useParams({ strict: false });
	const { pushError } = useErrorBanners();
	// Compose is a mail action, so its target only has to be known under `/mail`.
	// Resolving it from the root otherwise costs `/settings` and `/onboarding` a
	// config fetch plus a folder list per account for a button they never show.
	const underMail = location.pathname.startsWith("/mail");
	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
		enabled: underMail,
	});
	const target = useComposeTarget(underMail ? (config?.accounts ?? []) : []);

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

	// Opening compose also puts the surface on screen: only a mailbox route
	// mounts `FullCompose`, and only with no thread in the pane it takes over.
	const openCompose = useCallback(
		(params: Omit<ComposeState, "isOpen">) => {
			const search = location.search as Record<string, unknown>;
			// A folder names its open conversation in the path, so leaving it is a
			// navigation up to the list; the lists still to move name it in the query.
			const threadMailboxId = locationOpensDetail(location.pathname)
				? routeParams.mailboxId
				: undefined;
			const showsThread =
				Boolean(threadMailboxId) ||
				Boolean(search.selectedMessageId ?? search.selectedThreadId);
			if (!hostsComposeSurface(location.pathname)) {
				if (target.status === "loading") {
					pushError({
						severity: "info",
						title: "Not ready to write yet",
						detail:
							"Your folders are still loading. Try Compose again in a moment.",
					});
					return;
				}
				if (target.status === "none") {
					pushError({
						title: "Nowhere to write from",
						detail:
							"No account has a folder to open the message in. Check the account's folders in Settings, then try again.",
					});
					return;
				}
				setState({ ...params, isOpen: true });
				navigate({
					to: "/mail/$mailboxId",
					params: { mailboxId: target.mailboxId },
				});
				return;
			}
			setState({ ...params, isOpen: true });
			if (!showsThread) return;
			// A push, so Back reopens the message.
			if (threadMailboxId) {
				navigate({
					to: "/mail/$mailboxId",
					params: { mailboxId: threadMailboxId },
					search: (prev) => prev,
				});
				return;
			}
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
			routeParams.mailboxId,
			target,
			pushError,
		],
	);

	const closeCompose = useCallback(() => {
		setState(INITIAL_STATE);
	}, []);

	// Leaving the routes that mount the surface closes it, so nothing is left
	// open behind a view that cannot show it — which is how it used to reappear
	// unannounced on the next mailbox. Only a *change* of route counts: opening
	// compose navigates, and on the frame before that navigation lands the
	// pathname is still the one compose was started from.
	const previousPathnameRef = useRef(location.pathname);
	useEffect(() => {
		const previous = previousPathnameRef.current;
		previousPathnameRef.current = location.pathname;
		if (location.pathname === previous) return;
		if (hostsComposeSurface(location.pathname)) return;
		setState((current) => (current.isOpen ? INITIAL_STATE : current));
	}, [location.pathname]);

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
