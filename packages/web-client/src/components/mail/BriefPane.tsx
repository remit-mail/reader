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
import { ReadingPaneEmpty } from "@remit/ui";
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
import { useMailContext } from "@/lib/mail-context";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

interface BriefPaneContextValue {
	selectedMessageId: string | undefined;
	selectedThread: RemitImapThreadMessageResponse | undefined;
	onSelectMessage: (id: string) => void;
	onCloseThread: () => void;
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
				to: "/mail",
				search: (prev) => ({ ...prev, selectedMessageId: id }),
			});
		},
		[navigate],
	);

	const handleCloseThread = useCallback(() => {
		navigate({
			to: "/mail",
			search: (prev) => ({ ...prev, selectedMessageId: undefined }),
		});
	}, [navigate]);

	const ctx: BriefPaneContextValue = {
		selectedMessageId,
		selectedThread,
		onSelectMessage: handleSelectMessage,
		onCloseThread: handleCloseThread,
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
	const { selectedMessageId, onSelectMessage } = useBriefPane();
	const { accounts } = useMailContext();

	return (
		<DailyBrief
			accounts={accounts}
			selectedMessageId={selectedMessageId}
			onSelectMessage={onSelectMessage}
		/>
	);
}

/**
 * Brief reading pane: toolbar + ConversationView.
 * Mount in the `reading` slot of `AppShellSlotted`. Only rendered ≥ 1024px.
 */
function BriefReading() {
	const { selectedThread } = useBriefPane();
	const {
		onToggleIntelligence,
		searchInput,
		onSearchChange,
		onSearchClear,
		onSearchClearQuery,
	} = useMailContext();

	return (
		<section className="flex h-full w-full min-w-0 flex-col bg-canvas">
			<MessageToolbar
				hasThread={Boolean(selectedThread)}
				onCompose={() => undefined}
				intelligenceOpen={false}
				showIntelligenceToggle={false}
				onToggleIntelligence={onToggleIntelligence}
				searchValue={searchInput}
				onSearchChange={onSearchChange}
				onSearchClear={onSearchClear}
				onSearchClearQuery={onSearchClearQuery}
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
 * Phone view: ConversationView when thread is open, or the DailyBrief list.
 */
function BriefPhone() {
	const { selectedThread, selectedMessageId, onSelectMessage, onCloseThread } =
		useBriefPane();
	const { accounts, intelligenceOpen, onToggleIntelligence } = useMailContext();

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
			<DailyBrief
				accounts={accounts}
				selectedMessageId={selectedMessageId}
				onSelectMessage={onSelectMessage}
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
	Phone: BriefPhone,
});

export { BriefPane };
