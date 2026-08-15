import {
	configOperationsGetConfigOptions,
	threadDetailOperationsListThreadMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMessageAuthenticity } from "@remit/api-http-client/types.gen.ts";
import { MobileReadingPane } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConversationCompose } from "@/components/compose/ConversationCompose";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useMailboxAccount } from "@/hooks/useMailboxAccount";
import { useMarkAsRead } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { useToggleStar } from "@/hooks/useToggleStar";
import { type ReplyMode, useOpenReply, useReplySurface } from "@/routing";
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
		// The API reads a conversation oldest first (#81) and no `order` is asked
		// for: which turn came first is the thread's own fact, and which end of it
		// the pane puts at the top is the pane's.
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId },
		}),
	});

	const messages = useMemo(
		() => messagesResponse?.items ?? [],
		[messagesResponse?.items],
	);
	const latestMessage = messages[messages.length - 1];

	// Newest first, under the reply that answers it. The turn a reader came for
	// is the last one, and reading it should not cost a scroll past everything
	// that led to it.
	const orderedMessages = useMemo(() => [...messages].reverse(), [messages]);
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
			setFocusedIndex(0);
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

	// Scroll focused message into view. j and k walk the pane as it reads, so
	// the index they move is over the displayed order, not the fetched one.
	const scrollToMessage = useCallback(
		(index: number) => {
			const message = orderedMessages[index];
			if (!message) return;
			const element = messageRefs.current.get(message.threadMessageId);
			element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		},
		[orderedMessages],
	);

	// Keyboard navigation handlers
	const focusNext = useCallback(() => {
		if (orderedMessages.length === 0) return;
		const nextIndex = Math.min(focusedIndex + 1, orderedMessages.length - 1);
		setFocusedIndex(nextIndex);
		scrollToMessage(nextIndex);
	}, [orderedMessages.length, focusedIndex, scrollToMessage]);

	const focusPrevious = useCallback(() => {
		if (orderedMessages.length === 0) return;
		const prevIndex = Math.max(focusedIndex - 1, 0);
		setFocusedIndex(prevIndex);
		scrollToMessage(prevIndex);
	}, [orderedMessages.length, focusedIndex, scrollToMessage]);

	const toggleFocusedMessage = useCallback(() => {
		const message = orderedMessages[focusedIndex];
		if (message) {
			toggleExpanded(message.threadMessageId);
		}
	}, [orderedMessages, focusedIndex, toggleExpanded]);

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

	// The reply is a segment under the message it answers, so what is being
	// written and which turn it answers are both the address's to state. Nothing
	// here keeps a second opinion about whether a composer is up.
	const reply = useReplySurface();
	const openReply = useOpenReply();

	// Which turn a verb aimed at the whole conversation answers: the message the
	// address names, or the latest turn when it names none. A per-message button
	// passes its own instead, which the address could not express before this.
	const answeredMessageId = selectedMessageId ?? latestMessage?.messageId;

	const replyWith = useCallback(
		(mode: ReplyMode, messageId: string | undefined) => {
			if (!messageId) return;
			openReply({ threadId, messageId, mode });
		},
		[openReply, threadId],
	);

	const handleReply = useCallback(
		() => replyWith("reply", answeredMessageId),
		[replyWith, answeredMessageId],
	);

	const handleReplyAll = useCallback(
		() => replyWith("reply-all", answeredMessageId),
		[replyWith, answeredMessageId],
	);

	const handleForward = useCallback(
		() => replyWith("forward", answeredMessageId),
		[replyWith, answeredMessageId],
	);

	// Compose opens at the head of the pane, which from halfway down a long
	// thread is several screens up: without this, replying looks like nothing
	// happening. Aligned on its top edge, where the recipients are, and left
	// alone afterwards — it grows downward as it is written into, so following
	// its height would pull the rows being typed into off the top.
	//
	// Keyed on what is being answered and how, not on the draft under it: the
	// address gains a draft segment while the reader types, and scrolling there
	// would move the pane mid-sentence.
	const composeRef = useRef<HTMLDivElement>(null);
	const answering =
		reply?.kind === "reply"
			? `${reply.mode}:${reply.sourceMessageId}`
			: undefined;
	useEffect(() => {
		if (!answering) return;
		composeRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "start",
		});
	}, [answering]);

	// Register keyboard shortcuts
	useKeyboardNavigation({
		enabled: !isLoading && messages.length > 0 && reply === undefined,
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
	// cannot send says so. A card's verb answers that card's message, which is
	// the turn the address then names.
	const renderMessages = (mobile: boolean) => (
		<div data-testid="conversation-messages">
			{orderedMessages.map((message, index) => (
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
						onReply={
							mobile ? () => replyWith("reply", message.messageId) : undefined
						}
						onReplyAll={
							mobile
								? () => replyWith("reply-all", message.messageId)
								: undefined
						}
						onForward={
							mobile ? () => replyWith("forward", message.messageId) : undefined
						}
					/>
				</div>
			))}
		</div>
	);

	// The reply leads the pane, above the turn it answers: what is being written
	// is what the reader came back for, and it is not something to go looking
	// for under a thread. It scrolls with the conversation rather than floating
	// over it, so the pane has one scrollbar whether or not a reply is open.
	//
	// A segment naming no mode is a hand-typed address, and it says so where the
	// composer would have been rather than opening nothing: the conversation
	// behind it is still open and still readable.
	const compose = reply && (
		<div ref={composeRef}>
			{reply.kind === "reply" ? (
				<ConversationCompose surface={reply} />
			) : (
				<div className="border-b border-line bg-canvas p-4">
					<ErrorState
						variant="inline"
						title="That is not a way to answer a message"
						error={`"${reply.segment}" is not reply, reply-all or forward.`}
					/>
				</div>
			)}
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
				{compose}
				{renderMessages(true)}
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
			{/* The one scroller in the pane. The reply and the thread are both in
			    it, so neither has a scrollbar of its own and neither is squeezed
			    by the height the other takes. */}
			<div className="min-h-0 flex-1 overflow-auto">
				{compose}
				{renderMessages(false)}
			</div>
		</article>
	);
};
