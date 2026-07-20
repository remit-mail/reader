/**
 * FlaggedPane — compound component for the Flagged virtual mailbox
 * (/mail/flagged route).
 *
 * Mirrors BriefPane: it reads the unified cross-account thread list to resolve
 * the open thread and owns the list / reading / phone slots. The list itself is
 * a FLAT inbox of starred mail (see `FlaggedList`), not the sectioned brief.
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
import { FlaggedList } from "@/components/mail/FlaggedList";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { useMailContext } from "@/lib/mail-context";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface FlaggedPaneContextValue {
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	onSelectMessage: (id: string) => void;
	onCloseThread: () => void;
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

	const { data: threadsData } = useQuery({
		...unifiedThreadOperationsListAllThreadsOptions(),
		staleTime: 60_000,
	});

	const selectedThread = useMemo(() => {
		if (!selectedMessageId) return undefined;
		return threadsData?.items.find((t) => t.messageId === selectedMessageId);
	}, [threadsData, selectedMessageId]);

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

	const ctx: FlaggedPaneContextValue = {
		selectedMessageId,
		selectedThread,
		onSelectMessage: handleSelectMessage,
		onCloseThread: handleCloseThread,
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
	const { selectedMessageId, onSelectMessage } = useFlaggedPane();
	return (
		<FlaggedList
			selectedMessageId={selectedMessageId}
			onSelectMessage={onSelectMessage}
		/>
	);
}

/**
 * Reading pane: toolbar + ConversationView.
 * Mount in the `reading` slot of `AppShellSlotted`. Only rendered ≥ 1024px.
 */
function FlaggedReading() {
	const { selectedThread } = useFlaggedPane();
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
			/>
			<div className="min-h-0 flex-1 overflow-hidden">
				{selectedThread ? (
					<ConversationView
						threadId={selectedThread.threadId}
						mailboxId={selectedThread.mailboxId}
						subject={selectedThread.subject}
						authenticity={selectedThread.authenticity}
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
	const { selectedThread, onCloseThread } = useFlaggedPane();
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
