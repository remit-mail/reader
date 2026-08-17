/**
 * FlaggedPane — compound component for the Flagged virtual mailbox
 * (/mail/flagged route).
 *
 * Mirrors BriefPane in shape: it resolves the open thread and owns the list /
 * reading / phone slots. The list itself is a FLAT inbox of starred mail (see
 * `FlaggedList`), not the sectioned brief.
 *
 * The row prefers the starred listing, the same query that produced the rows,
 * and falls back to resolving the thread on its own when the address names
 * one the listing doesn't hold. The unified listing is INBOX-scoped, so
 * resolving against it left every starred thread filed elsewhere — Sent, an
 * archive folder, anything past the inbox window — visible in the list but
 * impossible to open (issue #70).
 *
 * Usage in the list layout route:
 *
 *   <FlaggedPane thread={useOpenThreadPath()}>
 *     <MailShell
 *       list={<FlaggedPane.List />}
 *       reading={<Outlet />}
 *     />
 *   </FlaggedPane>
 *
 * On phone, use `<FlaggedPane.Phone />` instead.
 */
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { ReadingPaneEmpty, useAppShellLayout } from "@remit/ui";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";
import { Drawer } from "@/components/layout/Drawer";
import { ConversationView } from "@/components/mail/ConversationView";
import { FlaggedList } from "@/components/mail/FlaggedList";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import type { OpenMessageOptions } from "@/components/mail/ThreadListInteraction";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useStarredThreads } from "@/hooks/useStarredThreads";
import { type ThreadActions, useThreadActions } from "@/hooks/useThreadActions";
import { useThreadRow } from "@/hooks/useThreadRow";
import {
	type TriageContext,
	useTriageContext,
	useTriageLayer,
} from "@/hooks/useTriageLayer";
import type { ConversationTarget } from "@/lib/conversation-target";
import { useMailContext } from "@/lib/mail-context";
import {
	type OpenThreadPath,
	type OpenThreadTarget,
	type ReplyMode,
	replyToThread,
	useIsComposing,
	useIsReplying,
	useOpenReply,
	useRetainOpenPanels,
} from "@/routing";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface FlaggedPaneContextValue {
	/** The row the reader pointed at, which is the one the list highlights. */
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	/** The conversation the pane shows, or none when the address names no thread. */
	conversation: ConversationTarget | undefined;
	onOpenThread: (
		target: OpenThreadTarget,
		options?: OpenMessageOptions,
	) => void;
	onCloseThread: () => void;
	/** The rows either side of the open one — the phone's swipe gestures. */
	nextThread: OpenThreadTarget | undefined;
	previousThread: OpenThreadTarget | undefined;
	/**
	 * Toolbar verbs for the open thread, keyed by the thread's own mailbox and
	 * account — Flagged spans accounts, so there is no route mailbox to key by.
	 */
	actions: ThreadActions;
	/**
	 * Answer the conversation the address has open. Absent when it names none,
	 * which is what the toolbar turns into its own explanation.
	 */
	onReply: ((mode: ReplyMode) => void) | undefined;
	/** Keyboard, multi-select and next/previous, shared with the mailbox view. */
	triage: TriageContext;
	onDeleteMessages: (messageIds: string[]) => void;
	/**
	 * Deselects the open message when it's the one a mutation just removed
	 * from view — wired into every mutation that can take the open message out
	 * of view (delete, report-spam/undo), so the reading pane and intelligence
	 * panel never keep rendering a message that's left the list.
	 */
	handleDeselectIfRemoved: (removedIds: string[]) => void;
}

const FlaggedPaneCtx = createContext<FlaggedPaneContextValue | null>(null);

function useFlaggedPane(): FlaggedPaneContextValue {
	const ctx = useContext(FlaggedPaneCtx);
	if (!ctx) throw new Error("FlaggedPane.* must be used inside <FlaggedPane>");
	return ctx;
}

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

interface FlaggedPaneProps {
	/** The open conversation, as the address states it. */
	thread: OpenThreadPath | undefined;
	children: ReactNode;
}

function FlaggedPaneProvider({ thread, children }: FlaggedPaneProps) {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { searchInput } = useMailContext();
	const threadId = thread?.threadId;
	const pointedAtMessageId = thread?.messageId;

	const { threads } = useStarredThreads();

	// The row the starred listing itself holds, preferred because a mutation
	// patches it in place. A thread reached from a cold address is in no listing
	// here and answers for itself — the folder it is filed in is the thread's own
	// data, so Starred spanning folders costs the URL nothing.
	const listedThread = useMemo(() => {
		if (!threadId) return undefined;
		return (
			threads.find((t) => t.messageId === pointedAtMessageId) ??
			threads.find((t) => t.threadId === threadId)
		);
	}, [threads, threadId, pointedAtMessageId]);
	const ownRow = useThreadRow(threadId, pointedAtMessageId);
	const selectedThread = listedThread ?? ownRow;

	const selectedMessageId = pointedAtMessageId ?? selectedThread?.messageId;

	const conversation = useMemo<ConversationTarget | undefined>(() => {
		if (!threadId) return undefined;
		return {
			threadId,
			mailboxId: selectedThread?.mailboxId ?? "",
			subject: selectedThread?.subject,
			messageId: selectedMessageId,
			authenticity: selectedThread?.authenticity,
		};
	}, [threadId, selectedThread, selectedMessageId]);

	const handleOpenThread = useCallback(
		(target: OpenThreadTarget, options?: OpenMessageOptions) => {
			navigate({
				to: "/mail/flagged/$threadId/$messageId",
				params: target,
				replace: options?.replace,
				// Commit the active query with the open so the debounced q-mirror —
				// which walks back up to the list when the query goes active — is
				// already satisfied and leaves the conversation alone. The *live*
				// `searchInput`: a row can be tapped before the debounce settles, when
				// the committed query is still empty.
				search: (prev) => ({ ...prev, q: searchInput || undefined }),
				hash: retainPanels,
			});
		},
		[navigate, retainPanels, searchInput],
	);

	const handleCloseThread = useCallback(() => {
		navigate({
			to: "/mail/flagged",
			search: (prev) => prev,
			hash: retainPanels,
		});
	}, [navigate, retainPanels]);

	const handleDeselectIfRemoved = useCallback(
		(removedIds: string[]) => {
			if (!selectedMessageId) return;
			if (!removedIds.includes(selectedMessageId)) return;
			handleCloseThread();
		},
		[selectedMessageId, handleCloseThread],
	);

	const actions = useThreadActions({
		thread: selectedThread,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	const triage = useTriageContext();

	// A Flagged selection spans accounts and mailboxes, so the listings these
	// patch are resolved from each message's own mailbox — the open thread's is
	// only the fallback.
	const { deleteMessages } = useDeleteMessages({
		mailboxId: selectedThread?.mailboxId ?? "",
		messages: threads,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});
	const { toggleReadFor } = useToggleReadFor({
		mailboxId: selectedThread?.mailboxId ?? "",
		messages: threads,
	});

	const focusedThreadId = triage.focusedMessageId;
	const focusedThread = useMemo(
		() => threads.find((t) => t.messageId === focusedThreadId),
		[threads, focusedThreadId],
	);
	const triageTarget = focusedThread ?? selectedThread;
	const triageActions = useThreadActions({ thread: triageTarget });

	// The toolbar answers the conversation on screen; the keyboard answers the
	// row the cursor is on, which may be one the address has not opened yet.
	// Both are one navigation, because the mode and the message it answers are
	// segments of the same address — there is no open-it-first step for the
	// answering half to be dropped from.
	const isComposing = useIsComposing();
	const isReplying = useIsReplying();
	const openReply = useOpenReply();
	const replyToOpenThread = useMemo(
		() => replyToThread(openReply, threadId, selectedMessageId),
		[openReply, threadId, selectedMessageId],
	);

	const replyToFocusedThread = useMemo(() => {
		if (!triageTarget) return undefined;
		return (mode: ReplyMode) =>
			openReply({
				threadId: triageTarget.threadId,
				messageId: triageTarget.messageId,
				mode,
			});
	}, [openReply, triageTarget]);

	const { nextMessageId, previousMessageId } = useTriageLayer({
		context: triage,
		orderedIds: triage.orderedIds,
		selectedMessageId,
		// The list stays mounted under both writing surfaces, so the triage keys
		// would otherwise fire at the message behind whatever is being typed — or
		// answer a row the cursor moved to while a reply was open.
		enabled: !isComposing && !isReplying,
		onClose: handleCloseThread,
		handlers: {
			reply: () => replyToFocusedThread?.("reply"),
			replyAll: () => replyToFocusedThread?.("reply-all"),
			forward: () => replyToFocusedThread?.("forward"),
			// The list takes any verb aimed at its selection and opens the wizard
			// on it, so a shortcut can never reach a bulk action the bar would have
			// reviewed. What comes back here is a verb aimed at the bare cursor.
			delete: () => {
				if (triage.listCommandsRef.current?.requestVerb("delete")) return;
				triageActions.deleteThread();
			},
			toggleStar: triageActions.toggleStar,
			toggleRead: () => {
				if (triage.listCommandsRef.current?.requestVerb("markRead")) return;
				if (!triageTarget) return;
				toggleReadFor([triageTarget.messageId], !triageTarget.isRead);
			},
			goBrief: () => navigate({ to: "/mail/brief" }),
			goSettings: () => navigate({ to: "/settings" }),
		},
	});

	// The swipe gestures open a whole conversation, so the adjacent row has to
	// name its thread. The starred listing is where that is looked up, so a row
	// it does not hold offers no gesture rather than a tap that goes nowhere.
	const adjacentThread = useCallback(
		(messageId: string | undefined): OpenThreadTarget | undefined => {
			if (!messageId) return undefined;
			const row = threads.find((t) => t.messageId === messageId);
			return row ? { threadId: row.threadId, messageId } : undefined;
		},
		[threads],
	);

	const ctx: FlaggedPaneContextValue = {
		selectedMessageId,
		selectedThread,
		conversation,
		onOpenThread: handleOpenThread,
		onCloseThread: handleCloseThread,
		nextThread: adjacentThread(nextMessageId),
		previousThread: adjacentThread(previousMessageId),
		actions,
		onReply: replyToOpenThread,
		triage,
		onDeleteMessages: deleteMessages,
		handleDeselectIfRemoved,
	};

	return (
		<FlaggedPaneCtx.Provider value={ctx}>{children}</FlaggedPaneCtx.Provider>
	);
}

/* ------------------------------------------------------------------ */
/* Sub-views                                                            */
/* ------------------------------------------------------------------ */

/** Flat starred list. Mount in the `list` slot of `AppShellSlotted`. */
function FlaggedListSlot() {
	const { selectedMessageId, onOpenThread, triage, onDeleteMessages } =
		useFlaggedPane();
	return (
		<FlaggedList
			selectedMessageId={selectedMessageId}
			onOpenThread={onOpenThread}
			commandsRef={triage.listCommandsRef}
			onTriageContextChange={triage.onTriageContextChange}
			onDeleteMessages={onDeleteMessages}
		/>
	);
}

/**
 * Reading pane: toolbar + ConversationView.
 * Mount in the `reading` slot of `AppShellSlotted`. Only rendered ≥ 1024px.
 */
function FlaggedReading() {
	const { conversation, actions, onReply } = useFlaggedPane();
	const { intelligenceOpen, onToggleIntelligence } = useMailContext();
	// The rail's own width gate, not the shell tier: between 1024 and 1280 the
	// reading pane is mounted but the rail is not, so "enabled" would promise an
	// open that cannot happen.
	const railFits = useAppShellLayout()?.showIntelligencePane ?? false;
	const hasThread = Boolean(conversation);
	const canToggleIntelligence = railFits && hasThread;

	return (
		<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<MessageToolbar
				hasThread={hasThread}
				intelligenceOpen={canToggleIntelligence && intelligenceOpen}
				canToggleIntelligence={canToggleIntelligence}
				onToggleIntelligence={onToggleIntelligence}
				onReply={onReply ? () => onReply("reply") : undefined}
				onReplyAll={onReply ? () => onReply("reply-all") : undefined}
				onForward={onReply ? () => onReply("forward") : undefined}
				onDelete={hasThread ? actions.deleteThread : undefined}
				onToggleStar={hasThread ? actions.toggleStar : undefined}
				isStarred={actions.isStarred}
				moveContext={
					hasThread && actions.accountId && actions.mailboxId
						? {
								accountId: actions.accountId,
								currentMailboxId: actions.mailboxId,
								onMove: actions.moveThread,
							}
						: undefined
				}
			/>
			<div className="min-h-0 flex-1 overflow-hidden">
				{conversation ? (
					<ConversationView
						threadId={conversation.threadId}
						mailboxId={conversation.mailboxId}
						subject={conversation.subject}
						selectedMessageId={conversation.messageId}
						authenticity={conversation.authenticity}
					/>
				) : (
					<ReadingPaneEmpty />
				)}
			</div>
		</section>
	);
}

/**
 * Intelligence pane: IntelligencePane for the open thread.
 * Mount in the `intelligence` slot of `AppShellSlotted`. Only rendered ≥ 1280px.
 */
function FlaggedIntelligence() {
	const { selectedThread, handleDeselectIfRemoved } = useFlaggedPane();
	const { onToggleIntelligence } = useMailContext();

	return (
		<IntelligencePane
			onClose={onToggleIntelligence}
			thread={selectedThread}
			mailboxId={selectedThread?.mailboxId}
			accountId={selectedThread?.accountId}
			onAfterOptimisticRemove={handleDeselectIfRemoved}
		/>
	);
}

/** Phone view: ConversationView when a thread is open, else the flat list. */
function FlaggedPhone() {
	const {
		selectedThread,
		conversation,
		onCloseThread,
		onOpenThread,
		nextThread,
		previousThread,
		handleDeselectIfRemoved,
	} = useFlaggedPane();
	const { intelligenceOpen, onToggleIntelligence } = useMailContext();

	if (conversation) {
		return (
			<>
				<ConversationView
					threadId={conversation.threadId}
					mailboxId={conversation.mailboxId}
					subject={conversation.subject}
					selectedMessageId={conversation.messageId}
					authenticity={conversation.authenticity}
					onBack={onCloseThread}
					onOpenIntelligence={onToggleIntelligence}
					onSwipeNext={nextThread ? () => onOpenThread(nextThread) : undefined}
					onSwipePrevious={
						previousThread ? () => onOpenThread(previousThread) : undefined
					}
					mobileIntelligenceOpen={intelligenceOpen}
				/>
				<Drawer
					isOpen={intelligenceOpen}
					onClose={onToggleIntelligence}
					ariaLabel="Message details"
					side="right"
				>
					<IntelligencePane
						onClose={onToggleIntelligence}
						thread={selectedThread}
						mailboxId={selectedThread?.mailboxId}
						accountId={selectedThread?.accountId}
						hideCloseButton
						onAfterOptimisticRemove={handleDeselectIfRemoved}
					/>
				</Drawer>
			</>
		);
	}

	return (
		<div className="h-full">
			<FlaggedListSlot />
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Compound component assembly                                          */
/* ------------------------------------------------------------------ */

const FlaggedPane = Object.assign(FlaggedPaneProvider, {
	List: FlaggedListSlot,
	Reading: FlaggedReading,
	Intelligence: FlaggedIntelligence,
	Phone: FlaggedPhone,
});

export { FlaggedPane };
