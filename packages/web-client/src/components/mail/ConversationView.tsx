import {
	configOperationsGetConfigOptions,
	messageOperationsDescribeMessageOptions,
	threadDetailOperationsListThreadMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { Forward, Reply, ReplyAll } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposeMode } from "@/components/compose/ComposeProvider";
import { InlineCompose } from "@/components/compose/InlineCompose";
import { EmptyState } from "@/components/ui/EmptyState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useMarkAsRead } from "@/hooks/useMarkAsRead";
import { useToggleStar } from "@/hooks/useToggleStar";
import { MessageCard } from "./MessageCard";

interface ConversationViewProps {
	threadId: string;
	mailboxId: string;
	subject?: string;
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
}

const ActionBar = ({
	onReply,
	onReplyAll,
	onForward,
	disabled,
}: ActionBarProps) => (
	<div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t border-border px-4 py-3">
		<div className="flex items-center gap-2">
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
}: ConversationViewProps) => {
	const { data: messagesResponse, isLoading } = useQuery({
		...threadDetailOperationsListThreadMessagesOptions({
			path: { threadId },
			query: { order: "desc", mailboxId },
		}),
	});

	const messages = useMemo(
		() => messagesResponse?.items ?? [],
		[messagesResponse?.items],
	);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
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

	// Mark messages as read when expanded
	useMarkAsRead({
		messages,
		expandedIds,
		threadId,
		mailboxId,
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

	const { data: config } = useQuery(configOperationsGetConfigOptions());
	const activeAccount = config?.accounts?.[0];
	const smtpConfigured = !!activeAccount?.smtpHost;

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

	if (messages.length === 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<EmptyState message="No messages in this thread" />
			</div>
		);
	}

	const displaySubject = subject || messages[0]?.subject || "(No subject)";
	const messageCount = messages.length;

	return (
		<article className="h-full flex flex-col">
			{/* Thread header */}
			<header className="border-b border-border p-4 shrink-0">
				<h1 className="text-xl font-semibold">{displaySubject}</h1>
				<p className="text-sm text-muted-foreground mt-1">
					{messageCount} {messageCount === 1 ? "message" : "messages"}
				</p>
			</header>

			{/* Messages list */}
			<div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
				<div className="px-4 py-2">
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
								onToggleStar={() =>
									toggleStar(message.messageId, message.hasStars)
								}
								isStarPending={
									isStarPending && pendingMessageId === message.messageId
								}
							/>
						</div>
					))}
				</div>
			</div>

			{/* Inline compose or action bar */}
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
