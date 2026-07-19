import {
	Button,
	type MailAction,
	MailActionToolbar,
	SearchBar,
} from "@remit/ui";
import { Info, SquarePen } from "lucide-react";
import { useState } from "react";
import { AccountMenu } from "@/auth/AccountMenu";
import { BugReportButton } from "@/components/ui/BugReportButton";
import { tooltipForAction } from "@/lib/keymap";
import { MoveToTrigger } from "./MoveToTrigger";

/**
 * Message action toolbar on the pane-header datum (40px, the shared
 * `--spacing-pane-header`). The reading pane's verbs — reply / reply-all /
 * forward, then delete / move / flag — Apple-Mail-style ghost icon buttons,
 * then the search field top-right (still filters the current list), compose
 * (✎) and the intelligence toggle (#422).
 *
 * Buttons are always pressable (never `disabled`): with no thread open a press
 * is a no-op that surfaces a one-line inline explanation rather than greying
 * out (`doc/rules/ux.md`).
 */
export interface MessageToolbarProps {
	hasThread: boolean;
	onCompose: () => void;
	intelligenceOpen: boolean;
	/**
	 * Whether the intelligence toggle is shown at all. The rail is contextual
	 * to an open message, so the toggle only appears once a thread is selected
	 * (matches the remit-ui AppShell reference) — it never opens an empty rail.
	 */
	showIntelligenceToggle: boolean;
	onToggleIntelligence: () => void;
	searchValue: string;
	onSearchChange: (value: string) => void;
	/** Full clear (X button): drops the query and any selected thread (#538). */
	onSearchClear: () => void;
	/** Query-only clear (Esc): drops the query, keeps the thread open (#489). */
	onSearchClearQuery?: () => void;

	/* ---- wired action callbacks (omit to keep the no-op-explain behaviour) ---- */
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	/** Delete all messages in the open thread. */
	onDelete?: () => void;
	/**
	 * Override the enabled state of the delete button. Defaults to `hasThread`.
	 * Pass `true` when a non-thread item (e.g. a Remit draft) is active so the
	 * trash icon acts without acting on the other thread-scoped verbs.
	 */
	canDelete?: boolean;
	/** Toggle the star on the most-recent message in the thread. */
	onToggleStar?: () => void;
	/** Whether the most-recent message is starred. */
	isStarred?: boolean;
	/**
	 * Move-to-mailbox trigger context. When present the FolderInput button
	 * is replaced by the full `MoveToTrigger` popover.
	 */
	moveContext?: {
		accountId: string;
		currentMailboxId: string;
		onMove: (destinationMailboxId: string) => void;
	};
}

const OPEN_FIRST = "Open a message first";

export const MessageToolbar = ({
	hasThread,
	onCompose,
	intelligenceOpen,
	showIntelligenceToggle,
	onToggleIntelligence,
	searchValue,
	onSearchChange,
	onSearchClear,
	onSearchClearQuery,
	onReply,
	onReplyAll,
	onForward,
	onDelete,
	canDelete,
	onToggleStar,
	isStarred,
	moveContext,
}: MessageToolbarProps) => {
	const [hint, setHint] = useState<string | null>(null);
	const canDeleteResolved = canDelete ?? hasThread;
	const explain = (message: string) => () => setHint(message);

	return (
		<MailActionToolbar
			hasThread={hasThread}
			isStarred={isStarred}
			onUnavailable={(_action: MailAction) => setHint(OPEN_FIRST)}
			unavailableHint={hint}
			replyTitle={`Reply ${tooltipForAction("reply")}`}
			replyAllTitle={`Reply all ${tooltipForAction("replyAll")}`}
			forwardTitle={`Forward ${tooltipForAction("forward")}`}
			deleteTitle={`Move to Trash ${tooltipForAction("delete")}`}
			flagTitle={`Star ${tooltipForAction("toggleStar")}`}
			onReply={onReply}
			onReplyAll={onReplyAll}
			onForward={onForward}
			onDelete={canDeleteResolved ? onDelete : explain(OPEN_FIRST)}
			onToggleStar={onToggleStar}
			onMove={explain(OPEN_FIRST)}
			moveSlot={
				moveContext ? (
					<MoveToTrigger
						accountId={moveContext.accountId}
						currentMailboxId={moveContext.currentMailboxId}
						onMove={moveContext.onMove}
						label="Move to mailbox"
					/>
				) : undefined
			}
		>
			{/* Apple Mail geometry: search sits top-right over the message area
			    but still filters the current list. Reuses the wired SearchBar
			    (the global "/" focus shortcut + Escape handling live in it). */}
			<div className="w-64 min-w-40 shrink">
				<SearchBar
					value={searchValue}
					onChange={onSearchChange}
					onClear={onSearchClear}
					onClearQuery={onSearchClearQuery}
					placeholder="Search mail"
				/>
			</div>
			<span className="mx-1 h-4 w-px bg-line" aria-hidden />
			<Button
				variant="ghost"
				size="sm"
				icon={<SquarePen className="size-4" />}
				title={`Compose ${tooltipForAction("compose")}`}
				aria-label="Compose"
				onClick={onCompose}
			/>
			{showIntelligenceToggle && (
				<Button
					variant="ghost"
					size="sm"
					icon={<Info className="size-4" />}
					title="Intelligence"
					aria-label={
						intelligenceOpen
							? "Hide intelligence sidebar"
							: "Show intelligence sidebar"
					}
					aria-pressed={intelligenceOpen}
					onClick={onToggleIntelligence}
					className={
						intelligenceOpen ? "bg-accent-2-soft text-accent-2" : undefined
					}
				/>
			)}
			<BugReportButton />
			<AccountMenu />
		</MailActionToolbar>
	);
};
