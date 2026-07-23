/**
 * BriefPane — compound component for the daily-brief view (/mail route).
 *
 * Usage in mail.tsx:
 *
 *   <BriefPane selectedMessageId={...}>
 *     <AppShellSlotted
 *       list={<BriefPane.List />}
 *       reading={<BriefPane.Reading />}
 *     />
 *   </BriefPane>
 *
 * On phone, use `<BriefPane.Phone />` instead.
 */
import { unifiedThreadOperationsListAllThreadsOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import {
	ReadingPaneEmpty,
	type SearchResult,
	useAppShellLayout,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
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
import { useDeleteMessages } from "@/hooks/useDeleteMessages";
import { useToggleReadFor } from "@/hooks/useMarkAsRead";
import { type ThreadActions, useThreadActions } from "@/hooks/useThreadActions";
import {
	type TriageContext,
	useTriageContext,
	useTriageLayer,
} from "@/hooks/useTriageLayer";
import {
	buildConversationTarget,
	type ConversationTarget,
} from "@/lib/conversation-target";
import { useMailContext } from "@/lib/mail-context";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface BriefPaneContextValue {
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	/** The conversation to open — the loaded thread, or a tapped "Related" hit. */
	conversation: ConversationTarget | undefined;
	onSelectMessage: (id: string) => void;
	onSelectSearchResult: (result: SearchResult) => void;
	onCloseThread: () => void;
	/**
	 * Toolbar verbs for the open thread, keyed by the thread's own mailbox and
	 * account — the brief spans accounts, so there is no route mailbox to key by.
	 */
	actions: ThreadActions;
	/** Keyboard, multi-select and next/previous, shared with the mailbox view. */
	triage: TriageContext;
	onDeleteMessages: (messageIds: string[]) => void;
	onMarkMessagesRead: (messageIds: string[]) => void;
	nextMessageId: string | undefined;
	previousMessageId: string | undefined;
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
	selectedMessageId: string | undefined;
	children: ReactNode;
}

function BriefPaneProvider({ selectedMessageId, children }: BriefPaneProps) {
	const navigate = useNavigate();
	const { searchInput } = useMailContext();
	const { selectedThreadId, selectedMailboxId } = useSearch({
		strict: false,
	}) as { selectedThreadId?: string; selectedMailboxId?: string };

	const { data: threadsData } = useQuery({
		...unifiedThreadOperationsListAllThreadsOptions(),
		staleTime: 60_000,
	});

	const selectedThread = useMemo(() => {
		if (!selectedMessageId) return undefined;
		return threadsData?.items.find((t) => t.messageId === selectedMessageId);
	}, [threadsData, selectedMessageId]);

	// A literal hit resolves to a loaded thread; a semantic "Related" hit may not
	// be in the capped brief list, so fall back to the thread + mailbox the hit
	// carried through the URL.
	const conversation = useMemo(
		() =>
			buildConversationTarget(selectedThread, {
				messageId: selectedMessageId,
				threadId: selectedThreadId,
				mailboxId: selectedMailboxId,
			}),
		[selectedThread, selectedMessageId, selectedThreadId, selectedMailboxId],
	);

	const handleSelectMessage = useCallback(
		(id: string) => {
			navigate({
				to: "/mail",
				search: (prev) => ({
					...prev,
					selectedMessageId: id,
					selectedThreadId: undefined,
					selectedMailboxId: undefined,
				}),
			});
		},
		[navigate],
	);

	const handleSelectSearchResult = useCallback(
		(result: SearchResult) => {
			navigate({
				to: "/mail",
				search: (prev) => ({
					...prev,
					// Commit the active query with the selection so the debounced
					// q-mirror (mail.tsx) — which strips the selection when the query
					// goes active — is already satisfied and leaves the opened result
					// alone. Use the *live* `searchInput`: the row can be tapped before
					// the debounce settles, when the committed query is still empty.
					q: searchInput || undefined,
					selectedMessageId: result.id,
					selectedThreadId: result.threadId,
					selectedMailboxId: result.mailboxId,
				}),
			});
		},
		[navigate, searchInput],
	);

	const handleDeselectIfRemoved = useCallback(
		(removedIds: string[]) => {
			if (!selectedMessageId) return;
			if (!removedIds.includes(selectedMessageId)) return;
			navigate({
				to: "/mail",
				search: (prev) => ({
					...prev,
					selectedMessageId: undefined,
					selectedThreadId: undefined,
					selectedMailboxId: undefined,
				}),
			});
		},
		[selectedMessageId, navigate],
	);

	const actions = useThreadActions({
		thread: selectedThread,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});

	const handleCloseThread = useCallback(() => {
		navigate({
			to: "/mail",
			search: (prev) => ({
				...prev,
				selectedMessageId: undefined,
				selectedThreadId: undefined,
				selectedMailboxId: undefined,
			}),
		});
	}, [navigate]);

	const triage = useTriageContext();

	// A brief selection spans accounts and mailboxes, so the listings these
	// patch are resolved from each message's own mailbox — the open thread's is
	// only the fallback.
	const briefThreads = useMemo(() => threadsData?.items ?? [], [threadsData]);
	const { deleteMessages } = useDeleteMessages({
		mailboxId: selectedThread?.mailboxId ?? "",
		messages: briefThreads,
		onAfterOptimisticRemove: handleDeselectIfRemoved,
	});
	const { toggleReadFor } = useToggleReadFor({
		mailboxId: selectedThread?.mailboxId ?? "",
		messages: briefThreads,
	});
	const handleMarkMessagesRead = useCallback(
		(messageIds: string[]) => toggleReadFor(messageIds, true),
		[toggleReadFor],
	);

	const focusedThreadId = triage.focusedMessageId;
	const focusedThread = useMemo(
		() => threadsData?.items.find((t) => t.messageId === focusedThreadId),
		[threadsData, focusedThreadId],
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
			goFlagged: () => navigate({ to: "/mail/flagged" }),
			goSettings: () => navigate({ to: "/settings" }),
		},
	});

	const ctx: BriefPaneContextValue = {
		selectedMessageId,
		selectedThread,
		conversation,
		onSelectMessage: handleSelectMessage,
		onSelectSearchResult: handleSelectSearchResult,
		onCloseThread: handleCloseThread,
		actions,
		triage,
		onDeleteMessages: deleteMessages,
		onMarkMessagesRead: handleMarkMessagesRead,
		nextMessageId,
		previousMessageId,
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
	const {
		selectedMessageId,
		onSelectMessage,
		onSelectSearchResult,
		triage,
		onDeleteMessages,
		onMarkMessagesRead,
	} = useBriefPane();
	const { accounts } = useMailContext();

	return (
		<DailyBrief
			accounts={accounts}
			selectedMessageId={selectedMessageId}
			onSelectMessage={onSelectMessage}
			onSelectSearchResult={onSelectSearchResult}
			commandsRef={triage.listCommandsRef}
			onTriageContextChange={triage.onTriageContextChange}
			onDeleteMessages={onDeleteMessages}
			onMarkMessagesRead={onMarkMessagesRead}
		/>
	);
}

/**
 * Brief reading pane: toolbar + ConversationView.
 * Mount in the `reading` slot of `AppShellSlotted`. Only rendered ≥ 1024px.
 */
function BriefReading() {
	const { conversation, actions } = useBriefPane();
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
				{conversation ? (
					<ConversationView
						threadId={conversation.threadId}
						mailboxId={conversation.mailboxId}
						subject={conversation.subject}
						selectedMessageId={conversation.messageId}
						authenticity={conversation.authenticity}
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
 * Intelligence pane: IntelligencePane for the thread open in the brief.
 * Mount in the `intelligence` slot of `AppShellSlotted`. Only rendered ≥ 1280px.
 */
function BriefIntelligence() {
	const { selectedThread } = useBriefPane();
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

/**
 * Phone view: ConversationView when thread is open, or the DailyBrief list.
 */
function BriefPhone() {
	const {
		selectedThread,
		conversation,
		selectedMessageId,
		onSelectMessage,
		onSelectSearchResult,
		onCloseThread,
		nextMessageId,
		previousMessageId,
	} = useBriefPane();
	const { accounts, intelligenceOpen, onToggleIntelligence } = useMailContext();

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
			<DailyBrief
				accounts={accounts}
				selectedMessageId={selectedMessageId}
				onSelectMessage={onSelectMessage}
				onSelectSearchResult={onSelectSearchResult}
			/>
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
