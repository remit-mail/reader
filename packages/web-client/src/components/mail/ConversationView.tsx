import {
	configOperationsGetConfigOptions,
	messageOperationsDescribeMessageOptions,
	threadDetailOperationsListThreadMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Forward, Reply, ReplyAll } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { InlineCompose } from "@/components/compose/InlineCompose";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useMarkAsRead } from "@/hooks/useMarkAsRead";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useToggleStar } from "@/hooks/useToggleStar";
import { MessageCard } from "./MessageCard";

interface ConversationViewProps {
	threadId: string;
	mailboxId: string;
	subject?: string;
	/**
	 * Mobile callers pass `onBack` so the action bar at the bottom of
	 * the conversation can render a Back button alongside Reply / Reply
	 * all / Forward. Desktop callers omit it — the message list is
	 * always visible in the resizable side pane.
	 */
	onBack?: () => void;
}

const LoadingSkeleton = () => (
	<div className="animate-pulse p-4">
		<div className="h-6 bg-muted rounded w-3/4 mb-6" />
		<div className="space-y-4">
			{Array.from({ length: 2 }).map((_, i) => (
				<div key={i} className="flex gap-3 py-3">
					<div className="size-10 bg-muted rounded-full shrink-0" />
					<div className="flex-1">
						<div className="h-4 bg-muted rounded w-32 mb-2" />
						<div className="h-3 bg-muted rounded w-48" />
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
		className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t border-border px-4 py-3"
		style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0))" }}
	>
		<div className="flex items-center gap-2 flex-wrap">
			{onBack && (
				<button
					type="button"
					onClick={onBack}
					className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-border hover:bg-accent transition-colors"
					aria-label="Back to messages"
				>
					<ArrowLeft className="size-4" />
					Back
				</button>
			)}
			<button
				type="button"
				onClick={onReply}
				disabled={disabled}
				className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<Reply className="size-4" />
				Reply
			</button>
			<button
				type="button"
				onClick={onReplyAll}
				disabled={disabled}
				className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<ReplyAll className="size-4" />
				Reply all
			</button>
			<button
				type="button"
				onClick={onForward}
				disabled={disabled}
				className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-border hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			>
				<Forward className="size-4" />
				Forward
			</button>
			{disabled && (
				<span className="text-xs text-muted-foreground ml-2">
					Configure SMTP to send mail
				</span>
			)}
		</div>
	</div>
);

export const ConversationView = ({
	threadId,
	mailboxId,
	subject,
	onBack,
}: ConversationViewProps) => {
	const isDesktop = useIsDesktop();
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

	// Compose state for inline reply/forward
	const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);

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
	}, []);

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

	const messagesList = (
		<div className="px-2 py-2 md:px-4">
			{messages.map((message, index) => (
				<div
					key={message.threadMessageId}
					ref={(el) => {
						if (el) messageRefs.current.set(message.threadMessageId, el);
					}}
				>
					{index > 0 && <div className="border-t border-border/50 my-1" />}
					<MessageCard
						threadMessage={message}
						isExpanded={expandedIds.has(message.threadMessageId)}
						isFocused={index === focusedIndex}
						onToggle={() => toggleExpanded(message.threadMessageId)}
						onToggleStar={() => toggleStar(message.messageId, message.hasStars)}
						isStarPending={
							isStarPending && pendingMessageId === message.messageId
						}
					/>
				</div>
			))}
		</div>
	);

	const header = (
		<header className="border-b border-border p-4">
			<h1 className="text-xl font-semibold">{displaySubject}</h1>
			<p className="text-sm text-muted-foreground mt-1">
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
				<div className="flex-1 overflow-y-auto">{messagesList}</div>
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
			<div className="flex-1 overflow-y-auto">{messagesList}</div>
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
