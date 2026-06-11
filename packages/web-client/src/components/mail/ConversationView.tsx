import {
	configOperationsGetConfigOptions,
	messageOperationsDescribeMessageOptions,
	threadDetailOperationsListThreadMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMessageAuthenticity } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Forward, Reply, ReplyAll, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { InlineCompose } from "@/components/compose/InlineCompose";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useMarkAsRead } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useToggleStar } from "@/hooks/useToggleStar";
import { MessageCard } from "./MessageCard";

interface ConversationViewProps {
	threadId: string;
	mailboxId: string;
	subject?: string;
	/**
	 * Authenticity signal from the thread row (DKIM mismatch). When present
	 * and `dkimMismatch` is true, a danger banner renders above the message
	 * body with a "Why?" link that opens the intelligence sidebar.
	 */
	authenticity?: RemitImapMessageAuthenticity;
	/**
	 * Callback for the "Why?" link in the authenticity banner — opens /
	 * focuses the intelligence sidebar.
	 */
	onOpenIntelligence?: () => void;
	/**
	 * Mobile callers pass `onBack` so the action bar at the bottom of
	 * the conversation can render a Back button alongside Reply / Reply
	 * all / Forward. Desktop callers omit it — the message list is
	 * always visible in the resizable side pane.
	 */
	onBack?: () => void;
	/**
	 * When set, immediately opens the inline compose in this mode. The
	 * parent (e.g. the reading-pane toolbar) sets this to wire the
	 * top-bar reply/reply-all/forward buttons into the inline compose
	 * that lives inside the conversation. Reset by calling
	 * `onComposeClose` after the compose opens.
	 */
	composeRequest?: ComposeMode | null;
	/**
	 * Called once the conversation has acted on `composeRequest` (or
	 * whenever the inline compose is dismissed). The caller should reset
	 * `composeRequest` to `null`.
	 */
	onComposeClose?: () => void;
}

const LoadingSkeleton = () => (
	<div className="animate-pulse p-4">
		<div className="h-6 bg-surface-sunken rounded w-3/4 mb-5" />
		<div className="space-y-4">
			{Array.from({ length: 2 }).map((_, i) => (
				<div key={i} className="flex gap-3 py-3">
					<div className="size-10 bg-surface-sunken rounded-full shrink-0" />
					<div className="flex-1">
						<div className="h-4 bg-surface-sunken rounded w-32 mb-2" />
						<div className="h-3 bg-surface-sunken rounded w-48" />
					</div>
				</div>
			))}
		</div>
	</div>
);

interface ActionBarProps {
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	disabled?: boolean;
	/**
	 * When provided, renders a leading Back chip (mobile callers pass
	 * this to dismiss the thread back to the message list). Desktop
	 * omits it — the message list is always visible in a side pane.
	 */
	onBack?: () => void;
}

const ActionBar = ({
	onReply,
	onReplyAll,
	onForward,
	disabled,
	onBack,
}: ActionBarProps) => (
	<div
		className="sticky bottom-0 bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80 border-t border-line px-4 py-3"
		style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0))" }}
	>
		{/* Narrow viewports (<640px) drop the text labels so all four
		    actions stay on one row — without this Forward orphans onto
		    a second row at phone widths. The lucide icons + aria-labels
		    keep the controls accessible. */}
		<div className="flex items-center gap-2">
			{onBack && (
				<button
					type="button"
					onClick={onBack}
					className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-11 text-sm font-medium rounded-full border border-line hover:bg-surface-raised transition-colors"
					aria-label="Back to messages"
				>
					<ArrowLeft className="size-4" />
					<span className="hidden sm:inline">Back</span>
				</button>
			)}
			<button
				type="button"
				onClick={onReply}
				disabled={disabled}
				aria-label="Reply"
				className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-11 text-sm font-medium rounded-full border border-line hover:bg-surface-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<Reply className="size-4" />
				<span className="hidden sm:inline">Reply</span>
			</button>
			<button
				type="button"
				onClick={onReplyAll}
				disabled={disabled}
				aria-label="Reply all"
				className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-11 text-sm font-medium rounded-full border border-line hover:bg-surface-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<ReplyAll className="size-4" />
				<span className="hidden sm:inline">Reply all</span>
			</button>
			<button
				type="button"
				onClick={onForward}
				disabled={disabled}
				aria-label="Forward"
				className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-11 text-sm font-medium rounded-full border border-line hover:bg-surface-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<Forward className="size-4" />
				<span className="hidden sm:inline">Forward</span>
			</button>
			{disabled && (
				<span className="text-xs text-fg-muted ml-2 hidden sm:inline">
					Configure SMTP to send mail
				</span>
			)}
		</div>
	</div>
);

/**
 * Danger banner rendered above the thread body when DKIM mismatch is detected.
 * Design spec (03-reading-and-intelligence.md): "a danger banner renders above
 * the body: 'This message claims to be a company but was sent from a personal
 * mailbox.' with a 'Why?' link that opens/highlights this section."
 */
function AuthenticityBanner({
	authenticity,
	onOpenIntelligence,
}: {
	authenticity: RemitImapMessageAuthenticity;
	onOpenIntelligence?: () => void;
}) {
	if (!authenticity.dkimMismatch) return null;

	return (
		<div className="flex items-start gap-2 rounded-none border-b border-danger/20 bg-danger-soft px-5 py-2.5 text-sm">
			<ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
			<p className="flex-1 leading-snug text-fg">
				This message claims to be from{" "}
				<span className="font-semibold">{authenticity.fromDomain}</span> but was
				sent
				{authenticity.dkimDomain
					? ` via ${authenticity.dkimDomain}`
					: " from a different domain"}
				.
			</p>
			{onOpenIntelligence && (
				<button
					type="button"
					onClick={onOpenIntelligence}
					className="shrink-0 text-2xs font-medium text-danger hover:underline"
				>
					Why?
				</button>
			)}
		</div>
	);
}

export const ConversationView = ({
	threadId,
	mailboxId,
	subject,
	authenticity,
	onOpenIntelligence,
	onBack,
	composeRequest,
	onComposeClose,
}: ConversationViewProps) => {
	const isDesktop = useIsDesktop();
	const { accountId: mailboxAccountId } = useMailboxAccount(mailboxId);
	const {
		data: messagesResponse,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId },
			query: { order: "desc", mailboxId },
		}),
	});

	const messages = useMemo(
		() => messagesResponse?.items ?? [],
		[messagesResponse?.items],
	);
	const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

	// Track which messages are expanded
	// By default, the first (newest) message is expanded
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
	const [focusedIndex, setFocusedIndex] = useState(0);

	// Reset and expand first message when thread changes or messages load
	useEffect(() => {
		if (messages.length > 0 && threadId !== currentThreadId) {
			setCurrentThreadId(threadId);
			setExpandedIds(new Set([messages[0].threadMessageId]));
			setFocusedIndex(0);
		}
	}, [threadId, messages, currentThreadId]);

	const toggleExpanded = useCallback((threadMessageId: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(threadMessageId)) {
				next.delete(threadMessageId);
			} else {
				next.add(threadMessageId);
			}
			return next;
		});
	}, []);

	// Scroll focused message into view
	const scrollToMessage = useCallback(
		(index: number) => {
			const message = messages[index];
			if (!message) return;
			const element = messageRefs.current.get(message.threadMessageId);
			element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		},
		[messages],
	);

	// Keyboard navigation handlers
	const focusNext = useCallback(() => {
		if (messages.length === 0) return;
		const nextIndex = Math.min(focusedIndex + 1, messages.length - 1);
		setFocusedIndex(nextIndex);
		scrollToMessage(nextIndex);
	}, [messages.length, focusedIndex, scrollToMessage]);

	const focusPrevious = useCallback(() => {
		if (messages.length === 0) return;
		const prevIndex = Math.max(focusedIndex - 1, 0);
		setFocusedIndex(prevIndex);
		scrollToMessage(prevIndex);
	}, [messages.length, focusedIndex, scrollToMessage]);

	const toggleFocusedMessage = useCallback(() => {
		const message = messages[focusedIndex];
		if (message) {
			toggleExpanded(message.threadMessageId);
		}
	}, [messages, focusedIndex, toggleExpanded]);

	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});
	const activeAccount = config?.accounts?.[0];
	const smtpConfigured = !!activeAccount?.smtpHost;

	// Mark messages as read immediately when expanded.
	useMarkAsRead({
		messages,
		expandedIds,
		threadId,
		mailboxId,
		accountId: activeAccount?.accountId,
	});

	// Star toggle functionality
	const {
		toggleStar,
		isPending: isStarPending,
		pendingMessageId,
	} = useToggleStar({
		threadId,
		mailboxId,
	});

	// Compose state for inline reply/forward.
	// Controlled via the `composeRequest` prop (toolbar wire-up) or
	// locally via the bottom ActionBar buttons.
	const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);

	// When the toolbar passes a composeRequest, open the inline compose.
	useEffect(() => {
		if (composeRequest && composeRequest !== "new") {
			setComposeMode(composeRequest);
			// Notify the parent that the request has been consumed.
			onComposeClose?.();
		}
	}, [composeRequest, onComposeClose]);

	const lastMessage = messages[0];
	const { data: lastMessageData } = useQuery({
		...messageOperationsDescribeMessageOptions({
			path: { messageId: lastMessage?.messageId ?? "" },
		}),
		enabled: !!lastMessage && composeMode !== null,
	});

	const handleReply = useCallback(() => {
		setComposeMode("reply");
	}, []);

	const handleReplyAll = useCallback(() => {
		setComposeMode("reply_all");
	}, []);

	const handleForward = useCallback(() => {
		setComposeMode("forward");
	}, []);

	const handleCloseCompose = useCallback(() => {
		setComposeMode(null);
		onComposeClose?.();
	}, [onComposeClose]);

	// Register keyboard shortcuts
	useKeyboardNavigation({
		enabled: !isLoading && messages.length > 0 && composeMode === null,
		bindings: [
			{ key: "j", handler: focusNext, preventDefault: true },
			{ key: "ArrowDown", handler: focusNext, preventDefault: true },
			{ key: "k", handler: focusPrevious, preventDefault: true },
			{ key: "ArrowUp", handler: focusPrevious, preventDefault: true },
			{ key: "Enter", handler: toggleFocusedMessage, preventDefault: true },
			{ key: "o", handler: toggleFocusedMessage, preventDefault: true },
			...(smtpConfigured
				? [
						{ key: "r", handler: handleReply, preventDefault: true },
						{
							key: "R",
							handler: handleReplyAll,
							noModifiers: false,
							preventDefault: true,
						},
						{ key: "f", handler: handleForward, preventDefault: true },
					]
				: []),
		],
	});

	if (isLoading) {
		return <LoadingSkeleton />;
	}

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center">
				<ErrorState
					title="Couldn't load this conversation"
					error={error}
					onRetry={() => refetch()}
				/>
			</div>
		);
	}

	if (messages.length === 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<EmptyState message="No messages in this thread" />
			</div>
		);
	}

	const displaySubject = subject || messages[0]?.subject || "(No subject)";
	const messageCount = messages.length;

	// Message list wrapper — no extra x-padding; each MessageCard handles
	// its own px-5 inset (matches the AppShell ReadingPane geometry).
	const messagesList = (
		<div>
			{messages.map((message, index) => (
				<div
					key={message.threadMessageId}
					ref={(el) => {
						if (el) messageRefs.current.set(message.threadMessageId, el);
					}}
				>
					<MessageCard
						threadMessage={message}
						isExpanded={expandedIds.has(message.threadMessageId)}
						isFocused={index === focusedIndex}
						onToggle={() => toggleExpanded(message.threadMessageId)}
						onToggleStar={() => toggleStar(message.messageId, message.hasStars)}
						isStarPending={
							isStarPending && pendingMessageId === message.messageId
						}
						accountId={mailboxAccountId}
					/>
				</div>
			))}
		</div>
	);

	// Subject block: matches the AppShell ReadingPane reference exactly —
	// px-5 pt-5 pb-3, text-lg leading-snug, 2xs count. Subject scrolls
	// with the thread body; no subject in the toolbar chrome.
	const header = (
		<header className="border-b border-line px-5 pt-5 pb-3">
			<h1 className="max-w-2xl text-lg font-semibold leading-snug text-fg">
				{displaySubject}
			</h1>
			<p className="mt-1 text-2xs text-fg-subtle">
				{messageCount} {messageCount === 1 ? "message" : "messages"}
			</p>
		</header>
	);

	// Mobile: a single scroll surface for messages, with the in-pane
	// ActionBar at the bottom. The subject header is intentionally
	// omitted — the user just clicked a row that showed the subject,
	// and the global top bar already shows the inbox name. When inline
	// compose opens it replaces the ActionBar and sticks to the bottom
	// of the scroll surface.
	if (!isDesktop) {
		return (
			<article className="h-full flex flex-col">
				{/* The phishing warning is just as important on mobile. There is no
				    intelligence sidebar on mobile (the 4-pane layout is desktop-only),
				    so the banner renders without a "Why?" link — the warning text
				    stands on its own. */}
				{authenticity?.dkimMismatch && (
					<AuthenticityBanner authenticity={authenticity} />
				)}
				<div className="flex-1 overflow-auto">{messagesList}</div>
				{composeMode !== null ? (
					<InlineCompose
						mode={composeMode}
						account={activeAccount}
						sourceMessage={lastMessageData}
						onClose={handleCloseCompose}
					/>
				) : (
					<ActionBar
						onBack={onBack}
						onReply={handleReply}
						onReplyAll={handleReplyAll}
						onForward={handleForward}
						disabled={!smtpConfigured}
					/>
				)}
			</article>
		);
	}

	return (
		<article className="h-full flex flex-col">
			{header}
			{authenticity?.dkimMismatch && (
				<AuthenticityBanner
					authenticity={authenticity}
					onOpenIntelligence={onOpenIntelligence}
				/>
			)}
			<div className="flex-1 overflow-auto">{messagesList}</div>
			{composeMode !== null ? (
				<InlineCompose
					mode={composeMode}
					account={activeAccount}
					sourceMessage={lastMessageData}
					onClose={handleCloseCompose}
				/>
			) : (
				<ActionBar
					onReply={handleReply}
					onReplyAll={handleReplyAll}
					onForward={handleForward}
					disabled={!smtpConfigured}
				/>
			)}
		</article>
	);
};
