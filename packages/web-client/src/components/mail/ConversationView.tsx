import {
	configOperationsGetConfigOptions,
	messageOperationsDescribeMessageOptions,
	threadDetailOperationsListThreadMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMessageAuthenticity } from "@remit/api-http-client/types.gen.ts";
import { MobileReadingPane } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { InlineCompose } from "@/components/compose/InlineCompose";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useMarkAsRead } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { useToggleStar } from "@/hooks/useToggleStar";
import { AuthenticityBanner } from "./AuthenticityBanner";
import { MessageCard } from "./MessageCard";

interface ConversationViewProps {
	threadId: string;
	mailboxId: string;
	subject?: string;
	/**
	 * The messageId of the row the user clicked in the thread list. When
	 * provided, this message is expanded on open (in addition to the newest
	 * message) so that viewing an older unread message marks it as read.
	 */
	selectedMessageId?: string;
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
	 * Mobile callers pass `onBack` to render a sticky Back button at the
	 * bottom of the conversation. Desktop callers omit it — the message
	 * list is always visible in the resizable side pane.
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
	 * whenever the inline compose is dismissed). The caller must reset
	 * `composeRequest` to `null`: a request left standing is read as a fresh
	 * one on every render.
	 */
	onComposeClose?: () => void;
	/**
	 * Mobile only: swipe-left handler to open the next message in the list the
	 * thread was opened from. Omitted at the end of the list so the gesture
	 * no-ops gracefully.
	 */
	onSwipeNext?: () => void;
	/**
	 * Mobile only: swipe-right handler to open the previous message in the list.
	 * Omitted at the start of the list.
	 */
	onSwipePrevious?: () => void;
	/** Whether the intelligence drawer is currently open (drives the ⓘ button pressed state). */
	mobileIntelligenceOpen?: boolean;
}

const LoadingSkeleton = () => (
	<div className="animate-pulse p-4">
		<div className="h-6 bg-surface-sunken rounded w-3/4 mb-5" />
		<div className="space-y-4">
			{Array.from({ length: 2 }).map((_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: list is static, no stable id
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

export const ConversationView = ({
	threadId,
	mailboxId,
	subject,
	selectedMessageId,
	authenticity,
	onOpenIntelligence,
	onBack,
	composeRequest,
	onComposeClose,
	onSwipeNext,
	onSwipePrevious,
	mobileIntelligenceOpen,
}: ConversationViewProps) => {
	const isDesktop = useIsDesktop();
	const { handlers: swipeHandlers } = useSwipeNavigation({
		onSwipeLeft: onSwipeNext,
		onSwipeRight: onSwipePrevious,
	});
	const { accountId: mailboxAccountId } = useMailboxAccount(mailboxId);
	const {
		data: messagesResponse,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		// The API reads a conversation oldest first (#81) and the pane renders it
		// in that order, so no `order` is asked for and none is re-sorted here.
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId },
		}),
	});

	const messages = useMemo(
		() => messagesResponse?.items ?? [],
		[messagesResponse?.items],
	);
	const latestMessage = messages[messages.length - 1];
	const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

	// Track which messages are expanded
	// By default, the latest message is expanded
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
	const [focusedIndex, setFocusedIndex] = useState(0);

	// Reset and expand the latest message when thread changes or messages load.
	// Also expand the selected message (the row the user clicked in the list)
	// so that an older unread message is visible and gets marked as read.
	useEffect(() => {
		if (messages.length > 0 && threadId !== currentThreadId) {
			setCurrentThreadId(threadId);
			const initialExpanded = new Set([
				messages[messages.length - 1].threadMessageId,
			]);
			if (selectedMessageId) {
				const selected = messages.find(
					(m) => m.messageId === selectedMessageId,
				);
				if (selected) initialExpanded.add(selected.threadMessageId);
			}
			setExpandedIds(initialExpanded);
			setFocusedIndex(messages.length - 1);
		}
	}, [threadId, messages, currentThreadId, selectedMessageId]);

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
		messages,
	});

	// Compose state for inline reply/forward.
	// Controlled via the `composeRequest` prop (toolbar wire-up) or
	// locally via r/a/f keyboard shortcuts.
	const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);

	// Counts openings rather than tracking the mode: replying from a second
	// message while compose is already open is the same request again, and the
	// reader still has to be taken to it.
	const [composeOpenings, setComposeOpenings] = useState(0);
	const openCompose = useCallback((mode: ComposeMode) => {
		setComposeMode(mode);
		setComposeOpenings((count) => count + 1);
	}, []);

	// When the toolbar passes a composeRequest, open the inline compose.
	useEffect(() => {
		if (composeRequest && composeRequest !== "new") {
			openCompose(composeRequest);
			// Notify the parent that the request has been consumed.
			onComposeClose?.();
		}
	}, [composeRequest, onComposeClose, openCompose]);

	// Reply and forward act on the latest turn of the conversation, which is the
	// last message now that the thread reads oldest first.
	const { data: latestMessageData } = useQuery({
		...messageOperationsDescribeMessageOptions({
			path: { messageId: latestMessage?.messageId ?? "" },
		}),
		enabled: !!latestMessage && composeMode !== null,
	});

	const handleReply = useCallback(() => openCompose("reply"), [openCompose]);

	const handleReplyAll = useCallback(
		() => openCompose("reply_all"),
		[openCompose],
	);

	const handleForward = useCallback(
		() => openCompose("forward"),
		[openCompose],
	);

	const handleCloseCompose = useCallback(() => {
		setComposeMode(null);
		onComposeClose?.();
	}, [onComposeClose]);

	// Compose opens below the message, which on a long one is several screens
	// down: without this, replying to it looks like nothing happening.
	//
	// Aligned on its bottom edge, where the send and discard verbs are, and held
	// there while it changes height. It mounts before the message it quotes has
	// been fetched and grows when that lands, so a single scroll at open time
	// puts whatever it grows past back below the fold.
	const composeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (composeMode === null || composeOpenings === 0) return;
		const surface = composeRef.current;
		if (!surface) return;
		const reveal = () =>
			surface.scrollIntoView({ behavior: "smooth", block: "end" });
		reveal();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(reveal);
		observer.observe(surface);
		return () => observer.disconnect();
	}, [composeOpenings, composeMode]);

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
			{ key: "r", handler: handleReply, preventDefault: true },
			{
				key: "R",
				handler: handleReplyAll,
				noModifiers: false,
				preventDefault: true,
			},
			{ key: "f", handler: handleForward, preventDefault: true },
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
	// its own px-5 inset (matches the AppShell ReadingPane geometry). On mobile
	// each expanded card owns a per-message action bar. Its reply verbs are
	// wired whatever the account's SMTP state: compose is where an account that
	// cannot send says so.
	const renderMessages = (mobile: boolean) => (
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
						mobile={mobile}
						onReply={mobile ? handleReply : undefined}
						onReplyAll={mobile ? handleReplyAll : undefined}
						onForward={mobile ? handleForward : undefined}
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

	// Mobile: the kit MobileReadingPane owns the chrome — a top app bar with
	// back, the email subject and the intelligence toggle (the host owns the
	// drawer). Each expanded card owns its per-message action bar; there is no
	// thread-level reply footer. The phishing warning leads the scroll content;
	// horizontal swipe between messages is wired through touchHandlers (#693).
	if (!isDesktop) {
		return (
			<MobileReadingPane
				thread={{ subject: displaySubject, messages: [] }}
				onBack={onBack ?? (() => undefined)}
				intelligenceOpen={mobileIntelligenceOpen}
				onToggleIntelligence={onOpenIntelligence}
				touchHandlers={swipeHandlers}
			>
				{authenticity?.dkimMismatch && (
					<AuthenticityBanner
						authenticity={authenticity}
						onOpenIntelligence={onOpenIntelligence}
					/>
				)}
				{renderMessages(true)}
				{composeMode !== null && (
					<div ref={composeRef}>
						<InlineCompose
							mode={composeMode}
							account={activeAccount}
							sourceMessage={latestMessageData}
							onClose={handleCloseCompose}
						/>
					</div>
				)}
			</MobileReadingPane>
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
			{/* The reply is part of the conversation, so it scrolls with it. Held
			    below the pane instead, it took whatever height the message left
			    over — nothing on a long one — and no amount of scrolling could
			    reach it. */}
			<div className="min-h-0 flex-1 overflow-auto">
				{renderMessages(false)}
				{composeMode !== null && (
					<div ref={composeRef}>
						<InlineCompose
							mode={composeMode}
							account={activeAccount}
							sourceMessage={latestMessageData}
							onClose={handleCloseCompose}
						/>
					</div>
				)}
			</div>
		</article>
	);
};
