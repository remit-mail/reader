import {
	configOperationsGetConfigOptions,
	messageOperationsDescribeMessageOptions,
	threadDetailOperationsListThreadMessagesOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapMessageAuthenticity } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	Forward,
	Info,
	Reply,
	ReplyAll,
	ShieldAlert,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import { MessageCard } from "./MessageCard";
import { MobileConversationTopBar } from "./MobileConversationTopBar";

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
	 * whenever the inline compose is dismissed). The caller should reset
	 * `composeRequest` to `null`.
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

	/* ---- Mobile management actions (rendered in MobileConversationTopBar) ---- */

	/** Archive all messages in the thread. */
	onMobileArchive?: () => void;
	/** Whether an archive mailbox exists. When false the Archive button still renders but its title explains. */
	canMobileArchive?: boolean;
	/** Delete all messages in the thread. */
	onMobileDelete?: () => void;
	/** Toggle star on the thread's representative (most-recent) message. */
	onMobileToggleStar?: () => void;
	/** Whether the representative message is starred. */
	isMobileStarred?: boolean;
	/** Toggle read/unread state of the thread's messages. */
	onMobileToggleRead?: () => void;
	/** Whether the representative message is currently read. */
	isMobileRead?: boolean;
	/** Move-to-mailbox context for the mobile overflow menu. */
	mobileMoveContext?: {
		accountId: string;
		currentMailboxId: string;
		onMove: (destinationMailboxId: string) => void;
	};
	/** Whether the intelligence drawer is currently open (drives the ⓘ button pressed state). */
	mobileIntelligenceOpen?: boolean;
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

/**
 * Mobile-only sticky footer. Desktop surfaces reply / reply-all / forward in
 * the top `MessageToolbar`, but that toolbar is not rendered on mobile, so the
 * touch reply affordances live here alongside the Back chip. Narrow viewports
 * drop the text labels so all four controls stay on one row.
 */
interface MobileActionBarProps {
	onBack?: () => void;
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	disabled?: boolean;
	/**
	 * Opens the message-details (info) drawer. The desktop info pane has no room
	 * on mobile, so this chip is the touch entry point into it (#687).
	 */
	onInfo?: () => void;
}

const mobileActionChip =
	"inline-flex items-center gap-2 px-3 sm:px-4 py-2 min-h-11 text-sm font-medium rounded-full border border-line hover:bg-surface-raised transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const MobileActionBar = ({
	onBack,
	onReply,
	onReplyAll,
	onForward,
	disabled,
	onInfo,
}: MobileActionBarProps) => (
	<div
		className="sticky bottom-0 bg-canvas/95 backdrop-blur supports-[backdrop-filter]:bg-canvas/80 border-t border-line px-4 py-3"
		style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0))" }}
	>
		<div className="flex items-center gap-2">
			{onBack && (
				<button
					type="button"
					onClick={onBack}
					className={mobileActionChip}
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
				className={mobileActionChip}
			>
				<Reply className="size-4" />
				<span className="hidden sm:inline">Reply</span>
			</button>
			<button
				type="button"
				onClick={onReplyAll}
				disabled={disabled}
				aria-label="Reply all"
				className={mobileActionChip}
			>
				<ReplyAll className="size-4" />
				<span className="hidden sm:inline">Reply all</span>
			</button>
			<button
				type="button"
				onClick={onForward}
				disabled={disabled}
				aria-label="Forward"
				className={mobileActionChip}
			>
				<Forward className="size-4" />
				<span className="hidden sm:inline">Forward</span>
			</button>
			{disabled && (
				<span className="text-xs text-fg-muted ml-2 hidden sm:inline">
					Configure SMTP to send mail
				</span>
			)}
			{onInfo && (
				<button
					type="button"
					onClick={onInfo}
					aria-label="Message details"
					className={cn(mobileActionChip, "ml-auto")}
				>
					<Info className="size-4" />
					<span className="hidden sm:inline">Details</span>
				</button>
			)}
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
	onMobileArchive,
	canMobileArchive,
	onMobileDelete,
	onMobileToggleStar,
	isMobileStarred,
	onMobileToggleRead,
	isMobileRead,
	mobileMoveContext,
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

	// Reset and expand first message when thread changes or messages load.
	// Also expand the selected message (the row the user clicked in the list)
	// so that an older unread message is visible and gets marked as read.
	useEffect(() => {
		if (messages.length > 0 && threadId !== currentThreadId) {
			setCurrentThreadId(threadId);
			const initialExpanded = new Set([messages[0].threadMessageId]);
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
	// locally via r/a/f keyboard shortcuts.
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

	// Mobile: a single scroll surface for messages. The subject header is
	// intentionally omitted — the user just clicked a row that showed the
	// subject, and the global top bar already shows the inbox name. A top bar
	// carries management actions (star, archive, delete, ⋮ overflow, info).
	// The sticky footer carries Back plus reply / reply-all / forward.
	// When inline compose opens it replaces the footer.
	if (!isDesktop) {
		const hasMobileActions =
			onMobileArchive !== undefined ||
			onMobileDelete !== undefined ||
			onMobileToggleStar !== undefined ||
			onMobileToggleRead !== undefined ||
			mobileMoveContext !== undefined ||
			onOpenIntelligence !== undefined;

		return (
			<article className="h-full flex flex-col">
				{hasMobileActions && (
					<MobileConversationTopBar
						hasThread
						onArchive={onMobileArchive}
						canArchive={canMobileArchive}
						onDelete={onMobileDelete}
						onToggleStar={onMobileToggleStar}
						isStarred={isMobileStarred}
						onToggleRead={onMobileToggleRead}
						isRead={isMobileRead}
						moveContext={mobileMoveContext}
						onOpenIntelligence={onOpenIntelligence}
						intelligenceOpen={mobileIntelligenceOpen}
					/>
				)}
				{/* The phishing warning is just as important on mobile. The "Why?"
				    link opens the info drawer that hosts the intelligence pane (#687). */}
				{authenticity?.dkimMismatch && (
					<AuthenticityBanner
						authenticity={authenticity}
						onOpenIntelligence={onOpenIntelligence}
					/>
				)}
				{/* Horizontal swipe pages between messages in the source list
				    (swipe left → next, right → previous). `touch-action: pan-y`
				    keeps native vertical scrolling; the hook only acts on gestures
				    that travel mostly sideways, so it never hijacks the scroll. */}
				<div
					className="flex-1 overflow-auto"
					style={{ touchAction: "pan-y" }}
					{...swipeHandlers}
				>
					{messagesList}
				</div>
				{composeMode !== null ? (
					<InlineCompose
						mode={composeMode}
						account={activeAccount}
						sourceMessage={lastMessageData}
						onClose={handleCloseCompose}
					/>
				) : (
					<MobileActionBar
						onBack={onBack}
						onReply={handleReply}
						onReplyAll={handleReplyAll}
						onForward={handleForward}
						disabled={!smtpConfigured}
						onInfo={onOpenIntelligence}
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
			{composeMode !== null && (
				<InlineCompose
					mode={composeMode}
					account={activeAccount}
					sourceMessage={lastMessageData}
					onClose={handleCloseCompose}
				/>
			)}
		</article>
	);
};
