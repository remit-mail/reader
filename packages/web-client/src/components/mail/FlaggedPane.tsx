/**
 * FlaggedPane — compound component for the Flagged virtual mailbox
 * (/mail/flagged route).
 *
 * Mirrors BriefPane in shape: it resolves the open thread and owns the list /
 * reading / phone slots. The list itself is a FLAT inbox of starred mail (see
 * `FlaggedList`), not the sectioned brief.
 *
 * The selection resolves from the starred listing, the same query that produced
 * the rows. The unified listing is INBOX-scoped, so resolving against it left
 * every starred thread filed elsewhere — Sent, an archive folder, anything past
 * the inbox window — visible in the list but impossible to open (issue #70).
 *
 *   <FlaggedPane selectedMessageId={...}>
 *     <AppShellSlotted
 *       list={<FlaggedPane.List />}
 *       reading={<FlaggedPane.Reading />}
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
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { useStarredThreads } from "@/hooks/useStarredThreads";
import { type ThreadActions, useThreadActions } from "@/hooks/useThreadActions";
import {
	type TriageContext,
	useTriageContext,
	useTriageLayer,
} from "@/hooks/useTriageLayer";
import { useMailContext } from "@/lib/mail-context";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface FlaggedPaneContextValue {
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	onSelectMessage: (id: string) => void;
	onCloseThread: () => void;
	/**
	 * Toolbar verbs for the open thread, keyed by the thread's own mailbox and
	 * account — Flagged spans accounts, so there is no route mailbox to key by.
	 */
	actions: ThreadActions;
	/** Keyboard, multi-select and next/previous, shared with the mailbox view. */
	triage: TriageContext;
	onDeleteMessages: (messageIds: string[]) => void;
	onMarkMessagesRead: (messageIds: string[]) => void;
	nextMessageId: string | undefined;
	previousMessageId: string | undefined;
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
	selectedMessageId: string | undefined;
	children: ReactNode;
}

function FlaggedPaneProvider({
	selectedMessageId,
	children,
}: FlaggedPaneProps) {
	const navigate = useNavigate();

	const { threads } = useStarredThreads();

	const selectedThread = useMemo(() => {
		if (!selectedMessageId) return undefined;
		return threads.find((t) => t.messageId === selectedMessageId);
	}, [threads, selectedMessageId]);

	const handleSelectMessage = useCallback(
		(id: string) => {
			navigate({
				to: "/mail/flagged",
				search: (prev) => ({ ...prev, selectedMessageId: id }),
			});
		},
		[navigate],
	);

	const handleCloseThread = useCallback(() => {
		navigate({
			to: "/mail/flagged",
			search: (prev) => ({ ...prev, selectedMessageId: undefined }),
		});
	}, [navigate]);

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

	const { deleteMessages } = useDeleteMessages({
		mailboxId: selectedThread?.mailboxId ?? "",
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});
	const { toggleReadFor } = useToggleReadFor({
		mailboxId: selectedThread?.mailboxId ?? "",
	});
	const handleMarkMessagesRead = useCallback(
		(messageIds: string[]) => toggleReadFor(messageIds, true),
		[toggleReadFor],
	);

	const focusedThreadId = triage.focusedMessageId;
	const focusedThread = useMemo(
		() => threads.find((t) => t.messageId === focusedThreadId),
		[threads, focusedThreadId],
	);
	const triageTarget = focusedThread ?? selectedThread;
	const triageActions = useThreadActions({ thread: triageTarget });

	const { nextMessageId, previousMessageId } = useTriageLayer({
		context: triage,
		orderedIds: triage.orderedIds,
		selectedMessageId,
		onClose: handleCloseThread,
		handlers: {
			reply: () => actions.requestCompose("reply"),
			replyAll: () => actions.requestCompose("reply_all"),
			forward: () => actions.requestCompose("forward"),
			delete: () => {
				if (triage.listCommandsRef.current?.requestDelete()) return;
				triageActions.deleteThread();
			},
			toggleStar: triageActions.toggleStar,
			toggleRead: () => {
				const ids =
					triage.selectedIds.length > 0
						? triage.selectedIds
						: triageTarget
							? [triageTarget.messageId]
							: [];
				if (ids.length === 0) return;
				toggleReadFor(ids, !(triageTarget?.isRead ?? false));
			},
			goBrief: () => navigate({ to: "/mail" }),
			goSettings: () => navigate({ to: "/settings" }),
		},
	});

	const ctx: FlaggedPaneContextValue = {
		selectedMessageId,
		selectedThread,
		onSelectMessage: handleSelectMessage,
		onCloseThread: handleCloseThread,
		actions,
		triage,
		onDeleteMessages: deleteMessages,
		onMarkMessagesRead: handleMarkMessagesRead,
		nextMessageId,
		previousMessageId,
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
	const {
		selectedMessageId,
		onSelectMessage,
		triage,
		onDeleteMessages,
		onMarkMessagesRead,
	} = useFlaggedPane();
	return (
		<FlaggedList
			selectedMessageId={selectedMessageId}
			onSelectMessage={onSelectMessage}
			commandsRef={triage.listCommandsRef}
			onTriageContextChange={triage.onTriageContextChange}
			onDeleteMessages={onDeleteMessages}
			onMarkMessagesRead={onMarkMessagesRead}
		/>
	);
}

/**
 * Reading pane: toolbar + ConversationView.
 * Mount in the `reading` slot of `AppShellSlotted`. Only rendered ≥ 1024px.
 */
function FlaggedReading() {
	const { selectedThread, actions } = useFlaggedPane();
	const { intelligenceOpen, onToggleIntelligence } = useMailContext();
	// The rail's own width gate, not the shell tier: between 1024 and 1280 the
	// reading pane is mounted but the rail is not, so "enabled" would promise an
	// open that cannot happen.
	const railFits = useAppShellLayout()?.showIntelligencePane ?? false;
	const hasThread = Boolean(selectedThread);
	const canToggleIntelligence = railFits && hasThread;

	return (
		<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<MessageToolbar
				hasThread={hasThread}
				intelligenceOpen={canToggleIntelligence && intelligenceOpen}
				canToggleIntelligence={canToggleIntelligence}
				onToggleIntelligence={onToggleIntelligence}
				onReply={hasThread ? () => actions.requestCompose("reply") : undefined}
				onReplyAll={
					hasThread ? () => actions.requestCompose("reply_all") : undefined
				}
				onForward={
					hasThread ? () => actions.requestCompose("forward") : undefined
				}
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
				{selectedThread ? (
					<ConversationView
						threadId={selectedThread.threadId}
						mailboxId={selectedThread.mailboxId}
						subject={selectedThread.subject}
						authenticity={selectedThread.authenticity}
						composeRequest={actions.composeRequest}
						onComposeClose={actions.clearComposeRequest}
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
	const { selectedThread } = useFlaggedPane();
	const { onToggleIntelligence } = useMailContext();

	return (
		<IntelligencePane
			onClose={onToggleIntelligence}
			thread={selectedThread}
			mailboxId={selectedThread?.mailboxId}
			accountId={selectedThread?.accountId}
		/>
	);
}

/** Phone view: ConversationView when a thread is open, else the flat list. */
function FlaggedPhone() {
	const {
		selectedThread,
		onCloseThread,
		onSelectMessage,
		nextMessageId,
		previousMessageId,
	} = useFlaggedPane();
	const { intelligenceOpen, onToggleIntelligence } = useMailContext();

	if (selectedThread) {
		return (
			<>
				<ConversationView
					threadId={selectedThread.threadId}
					mailboxId={selectedThread.mailboxId}
					subject={selectedThread.subject}
					authenticity={selectedThread.authenticity}
					onBack={onCloseThread}
					onOpenIntelligence={onToggleIntelligence}
					onSwipeNext={
						nextMessageId ? () => onSelectMessage(nextMessageId) : undefined
					}
					onSwipePrevious={
						previousMessageId
							? () => onSelectMessage(previousMessageId)
							: undefined
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
						hideCloseButton
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
