/**
 * BriefPane — compound component for the daily brief.
 *
 * Usage in the list layout route:
 *
 *   <BriefPane thread={useOpenThreadPath()}>
 *     <MailShell
 *       list={<BriefPane.List />}
 *       reading={<Outlet />}
 *     />
 *   </BriefPane>
 *
 * On phone, use `<BriefPane.Phone />` instead.
 */
import { unifiedThreadOperationsListAllThreadsOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { ReadingPaneEmpty, useAppShellLayout } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
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
import { DailyBrief } from "@/components/mail/DailyBrief";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import type { OpenMessageOptions } from "@/components/mail/ThreadListInteraction";
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
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
	useIsComposing,
	useIsReplying,
	useOpenReply,
	useReplyToOpenThread,
	useRetainOpenPanels,
} from "@/routing";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface BriefPaneContextValue {
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
	 * account — the brief spans accounts, so there is no route mailbox to key by.
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

const BriefPaneCtx = createContext<BriefPaneContextValue | null>(null);

function useBriefPane(): BriefPaneContextValue {
	const ctx = useContext(BriefPaneCtx);
	if (!ctx) throw new Error("BriefPane.* must be used inside <BriefPane>");
	return ctx;
}

/* ------------------------------------------------------------------ */
/* Provider                                                             */
/* ------------------------------------------------------------------ */

interface BriefPaneProps {
	/** The open conversation, as the address states it. */
	thread: OpenThreadPath | undefined;
	children: ReactNode;
}

function BriefPaneProvider({ thread, children }: BriefPaneProps) {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { searchInput } = useMailContext();
	const threadId = thread?.threadId;
	const pointedAtMessageId = thread?.messageId;

	const { data: threadsData } = useQuery({
		...unifiedThreadOperationsListAllThreadsOptions(),
		staleTime: 60_000,
	});
	const briefThreads = useMemo(() => threadsData?.items ?? [], [threadsData]);

	// The row the brief itself lists, preferred because a mutation patches it in
	// place. A thread reached from a cross-folder search hit or a cold address is
	// in no listing here, and answers for itself — which is where
	// `selectedMailboxId` used to come in: the folder a thread is filed in is the
	// thread's own data, so the brief spanning folders costs the URL nothing.
	const listedThread = useMemo(() => {
		if (!threadId) return undefined;
		return (
			briefThreads.find((t) => t.messageId === pointedAtMessageId) ??
			briefThreads.find((t) => t.threadId === threadId)
		);
	}, [briefThreads, threadId, pointedAtMessageId]);
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
				to: "/mail/brief/$threadId/$messageId",
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
			to: "/mail/brief",
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

	// A brief selection spans accounts and mailboxes, so the listings these
	// patch are resolved from each message's own mailbox — the open thread's is
	// only the fallback.
	const { deleteMessages } = useDeleteMessages({
		mailboxId: selectedThread?.mailboxId ?? "",
		messages: briefThreads,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});
	const { toggleReadFor } = useToggleReadFor({
		mailboxId: selectedThread?.mailboxId ?? "",
		messages: briefThreads,
	});

	const focusedThreadId = triage.focusedMessageId;
	const focusedThread = useMemo(
		() => briefThreads.find((t) => t.messageId === focusedThreadId),
		[briefThreads, focusedThreadId],
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
	const replyToOpenThread = useReplyToOpenThread(selectedThread?.messageId);

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
			goFlagged: () => navigate({ to: "/mail/flagged" }),
			goSettings: () => navigate({ to: "/settings" }),
		},
	});

	// The swipe gestures open a whole conversation, so the adjacent row has to
	// name its thread. The brief's own listing is where that is looked up, so a
	// row it does not hold offers no gesture rather than a tap that goes nowhere.
	const adjacentThread = useCallback(
		(messageId: string | undefined): OpenThreadTarget | undefined => {
			if (!messageId) return undefined;
			const row = briefThreads.find((t) => t.messageId === messageId);
			return row ? { threadId: row.threadId, messageId } : undefined;
		},
		[briefThreads],
	);

	const ctx: BriefPaneContextValue = {
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

	return <BriefPaneCtx.Provider value={ctx}>{children}</BriefPaneCtx.Provider>;
}

/* ------------------------------------------------------------------ */
/* Sub-views                                                            */
/* ------------------------------------------------------------------ */

/**
 * Daily brief list. Mount in the `list` slot of `AppShellSlotted`.
 */
function BriefList() {
	const { selectedMessageId, onOpenThread, triage, onDeleteMessages } =
		useBriefPane();
	const { accounts } = useMailContext();

	return (
		<DailyBrief
			accounts={accounts}
			selectedMessageId={selectedMessageId}
			onOpenThread={onOpenThread}
			commandsRef={triage.listCommandsRef}
			onTriageContextChange={triage.onTriageContextChange}
			onDeleteMessages={onDeleteMessages}
		/>
	);
}

/**
 * Brief reading pane: toolbar + ConversationView.
 * Mount in the `reading` slot of `AppShellSlotted`. Only rendered ≥ 1024px.
 */
function BriefReading() {
	const { conversation, actions, onReply } = useBriefPane();
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
 * Intelligence pane: IntelligencePane for the thread open in the brief.
 * Mount in the `intelligence` slot of `AppShellSlotted`. Only rendered ≥ 1280px.
 */
function BriefIntelligence() {
	const { selectedThread, handleDeselectIfRemoved } = useBriefPane();
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

/**
 * Phone view: ConversationView when thread is open, or the DailyBrief list.
 */
function BriefPhone() {
	const {
		selectedThread,
		conversation,
		onOpenThread,
		onCloseThread,
		nextThread,
		previousThread,
		handleDeselectIfRemoved,
	} = useBriefPane();
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

	// The same list slot the multi-pane layout mounts, so the phone brief wires
	// the bulk verbs and the selection bar through `DailyBrief` exactly as the
	// desktop list does. Rendering `DailyBrief` here directly dropped
	// `onDeleteMessages`, so a phone selection raised no action bar (#203) — the
	// same reuse `FlaggedPhone` already relies on.
	return (
		<div className="h-full">
			<BriefList />
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Compound component assembly                                          */
/* ------------------------------------------------------------------ */

const BriefPane = Object.assign(BriefPaneProvider, {
	List: BriefList,
	Reading: BriefReading,
	Intelligence: BriefIntelligence,
	Phone: BriefPhone,
});

export { BriefPane };
