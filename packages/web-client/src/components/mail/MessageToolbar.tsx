import { Button, type MailAction, MailActionToolbar } from "@remit/ui";
import { Info } from "lucide-react";
import { useState } from "react";
import { tooltipForAction } from "@/lib/keymap";
import { MoveToTrigger } from "./MoveToTrigger";

/**
 * Message action toolbar on the pane-header datum (40px, the shared
 * `--spacing-pane-header`). Everything here acts on the open message: reply /
 * reply-all / forward, then delete / move / flag — Apple-Mail-style ghost icon
 * buttons — and the intelligence toggle (#422).
 *
 * Search, compose, bug report and the account menu are not message context;
 * they live in the app top bar above every pane (`MailTopBar`, #49).
 *
 * Buttons are always pressable (never `disabled`): with no thread open a press
 * is a no-op that surfaces a one-line inline explanation rather than greying
 * out (`doc/rules/ux.md`).
 */
export interface MessageToolbarProps {
	hasThread: boolean;
	intelligenceOpen: boolean;
	/**
	 * Whether the intelligence toggle is shown at all. The rail is contextual
	 * to an open message, so the toggle only appears once a thread is selected
	 * (matches the remit-ui AppShell reference) — it never opens an empty rail.
	 */
	showIntelligenceToggle: boolean;
	onToggleIntelligence: () => void;

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
	intelligenceOpen,
	showIntelligenceToggle,
	onToggleIntelligence,
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
		</MailActionToolbar>
	);
};
