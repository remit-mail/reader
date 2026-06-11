/**
 * /mail — Daily Brief (unified inbox landing view).
 *
 * The default landing route that answers "what needs my attention today?"
 * across all non-muted accounts. Replaces the previous redirect-to-first-
 * mailbox behaviour with the three-section brief defined in
 * doc/design/flows/02-daily-brief.md and the Flows/DailyBrief stories.
 */
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@remit/ui";
import {
	createFileRoute,
	type ErrorComponentProps,
} from "@tanstack/react-router";
import { z } from "zod";
import { DailyBrief } from "@/components/mail/DailyBrief";
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

const briefSearchSchema = z.object({
	selectedMessageId: z.string().optional(),
});

export const Route = createFileRoute("/mail/")({
	component: MailIndex,
	validateSearch: briefSearchSchema,
	errorComponent: MailIndexError,
});

function MailIndex() {
	const { selectedMessageId } = Route.useSearch();
	const {
		accounts,
		intelligenceOpen,
		onToggleIntelligence,
		searchInput,
		onSearchChange,
		onSearchClear,
	} = useMailContext();
	const isDesktop = useIsDesktop();

	const showIntelligence = intelligenceOpen && Boolean(selectedMessageId);

	if (!isDesktop) {
		return (
			<div className="h-full">
				<DailyBrief accounts={accounts} selectedMessageId={selectedMessageId} />
			</div>
		);
	}

	// Desktop: brief is pane 2 (list), reading pane 3 is empty (threads are
	// opened in /mail/$mailboxId via BriefRow links).
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
				<DailyBrief accounts={accounts} selectedMessageId={selectedMessageId} />
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
						hasThread={false}
						onCompose={() => undefined}
						intelligenceOpen={false}
						showIntelligenceToggle={false}
						onToggleIntelligence={onToggleIntelligence}
						searchValue={searchInput}
						onSearchChange={onSearchChange}
						onSearchClear={onSearchClear}
					/>
					<div className="min-h-0 flex-1 overflow-hidden flex items-center justify-center">
						<EmptyState message="Select a thread to read" />
					</div>
				</section>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}
