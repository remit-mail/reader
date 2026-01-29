import { threadDetailOperationsListThreadMessagesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";
import { Forward, Reply, ReplyAll } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
}

const ActionBar = ({ onReply, onReplyAll, onForward }: ActionBarProps) => (
	<div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t border-border px-4 py-3">
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={onReply}
				className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-border hover:bg-accent transition-colors"
			>
				<Reply className="size-4" />
				Reply
			</button>
			<button
				type="button"
				onClick={onReplyAll}
				className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-border hover:bg-accent transition-colors"
			>
				<ReplyAll className="size-4" />
				Reply all
			</button>
			<button
				type="button"
				onClick={onForward}
				className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-border hover:bg-accent transition-colors"
			>
				<Forward className="size-4" />
				Forward
			</button>
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

	// Register keyboard shortcuts
	useKeyboardNavigation({
		enabled: !isLoading && messages.length > 0,
		bindings: [
			{ key: "j", handler: focusNext, preventDefault: true },
			{ key: "ArrowDown", handler: focusNext, preventDefault: true },
			{ key: "k", handler: focusPrevious, preventDefault: true },
			{ key: "ArrowUp", handler: focusPrevious, preventDefault: true },
			{ key: "Enter", handler: toggleFocusedMessage, preventDefault: true },
			{ key: "o", handler: toggleFocusedMessage, preventDefault: true },
		],
	});

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

	// Action handlers (placeholder for now - will be implemented with compose feature)
	const handleReply = useCallback(() => {
		// TODO: Implement reply
		console.log("Reply clicked");
	}, []);

	const handleReplyAll = useCallback(() => {
		// TODO: Implement reply all
		console.log("Reply all clicked");
	}, []);

	const handleForward = useCallback(() => {
		// TODO: Implement forward
		console.log("Forward clicked");
	}, []);

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

			{/* Action bar */}
			<ActionBar
				onReply={handleReply}
				onReplyAll={handleReplyAll}
				onForward={handleForward}
			/>
		</article>
	);
};
