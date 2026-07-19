import { IntelligenceToggle, type MailAction, MailActionToolbar } from "@remit/ui";
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
 * The control set is fixed: every button occupies the same slot on every view
 * and in every selection state (#52). The mail verbs stay pressable with no
 * thread open — a press is a no-op that surfaces a one-line inline explanation
 * (`doc/rules/ux.md`). The intelligence toggle greys out instead, because it
 * has nothing to explain: it opens a rail, and there is no rail to open.
 */
export interface MessageToolbarProps {
	hasThread: boolean;
	intelligenceOpen: boolean;
	/**
	 * Whether pressing the intelligence toggle would open a rail: the view has
	 * one, the width allows it, and a thread is selected. The button renders
	 * either way — disabled when false, never absent (#52).
	 */
	canToggleIntelligence: boolean;
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
	canToggleIntelligence,
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
			<IntelligenceToggle
				open={intelligenceOpen}
				enabled={canToggleIntelligence}
				onToggle={onToggleIntelligence}
			/>
		</MailActionToolbar>
	);
};
