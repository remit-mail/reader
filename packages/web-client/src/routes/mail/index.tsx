/**
 * /mail — Daily Brief (unified inbox landing view).
 *
 * The default landing route that answers "what needs my attention today?"
 * across all non-muted accounts. Replaces the previous redirect-to-first-
 * mailbox behaviour with the three-section brief defined in
 * doc/design/flows/02-daily-brief.md and the Flows/DailyBrief stories.
 */
import { unifiedThreadOperationsListAllThreadsOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	type ErrorComponentProps,
	useNavigate,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { Drawer } from "@/components/layout/Drawer";
import { ConversationView } from "@/components/mail/ConversationView";
import { DailyBrief } from "@/components/mail/DailyBrief";
import { IntelligencePane } from "@/components/mail/IntelligencePane";
import { MessageToolbar } from "@/components/mail/MessageToolbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useMailContext } from "@/lib/mail-context";

const MailIndexError = ({ error, reset }: ErrorComponentProps) => (
	<div className="flex h-full items-center justify-center bg-canvas p-4">
		<ErrorState
			title="Couldn't load your mailboxes"
			error={error}
			onRetry={reset}
		/>
	</div>
);

// `q` is inherited from the parent /mail route; re-declared here (like the
// mailbox route) so it survives this route's own search validation and isn't
// dropped when navigating with a functional search updater.
const briefSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
	q: z.string().optional(),
});

export const Route = createFileRoute("/mail/")({
	component: MailIndex,
	validateSearch: briefSearchSchema,
	errorComponent: MailIndexError,
});

function MailIndex() {
	const { selectedMessageId } = Route.useSearch();
	const navigate = useNavigate();
	const {
		accounts,
		intelligenceOpen,
		onToggleIntelligence,
		searchInput,
		onSearchChange,
		onSearchClear,
		onSearchClearQuery,
	} = useMailContext();
	const isDesktop = useIsDesktop();

	const showIntelligence = intelligenceOpen && Boolean(selectedMessageId);

	// The brief already fetches this; the query cache makes this free.
	const { data: threadsData } = useQuery({
		...unifiedThreadOperationsListAllThreadsOptions(),
		staleTime: 60_000,
	});

	// Look up threadId + mailboxId for the selected message
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

	if (!isDesktop) {
		if (selectedThread) {
			return (
				<>
					<ConversationView
						threadId={selectedThread.threadId}
						mailboxId={selectedThread.mailboxId}
						subject={selectedThread.subject}
						authenticity={selectedThread.authenticity}
						onBack={handleCloseThread}
						onOpenIntelligence={onToggleIntelligence}
					/>
					{/* Info panel as a right-side drawer — same affordance as the
					    mailbox view so message details stay reachable on mobile (#687). */}
					<Drawer
						isOpen={intelligenceOpen}
						onClose={onToggleIntelligence}
						ariaLabel="Message details"
						side="right"
					>
						<IntelligencePane
							onClose={onToggleIntelligence}
							thread={selectedThread}
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
					onSelectMessage={handleSelectMessage}
				/>
			</div>
		);
	}

	// Desktop: brief is pane 2 (list), reading pane 3 shows the selected thread.
	return (
		<ResizablePanelGroup direction="horizontal">
			<ResizablePanel
				id="brief-list"
				order={1}
				defaultSize={showIntelligence ? 30 : 33}
				minSize={20}
				maxSize={48}
				className="min-w-0"
			>
				<DailyBrief
					accounts={accounts}
					selectedMessageId={selectedMessageId}
					onSelectMessage={handleSelectMessage}
				/>
			</ResizablePanel>
			<ResizableHandle />
			<ResizablePanel
				id="brief-reading"
				order={2}
				minSize={24}
				className="min-w-0"
			>
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
							/>
						) : (
							<div className="flex h-full items-center justify-center">
								<EmptyState message="Select a thread to read" />
							</div>
						)}
					</div>
				</section>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
