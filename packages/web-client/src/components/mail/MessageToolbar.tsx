import {
	IntelligenceToggle,
	type MailAction,
	MailActionToolbar,
	tooltipForAction,
} from "@remit/ui";
import { useState } from "react";
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
	/**
	 * The message the verbs act on, as the address states it. The inline notice
	 * a press leaves behind belongs to that message and to nothing after it, so
	 * opening another one takes the sentence down (#818).
	 */
	messageId?: string;
	intelligenceOpen: boolean;
	/**
	 * Whether pressing the intelligence toggle would open anything: the view has
	 * an intelligence surface at this width — the rail, or the drawer where the
	 * rail does not fit — and a thread is selected. The button renders either
	 * way, disabled when false, never absent (#52).
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

/**
 * A thread is open and the verb still has nothing to act on — the conversation
 * has not said which turn answers for it yet. A press has to say so: the
 * shared toolbar only explains itself when there is no thread at all, so an
 * unwired handler under an open one would be swallowed in silence (#803).
 */
const NOT_LOADED_YET = "This conversation hasn't loaded yet";

/**
 * Move alone waits on a second read — the account owning this mailbox, found by
 * fanning out over every account's mailbox list. With the message on screen and
 * that fan-out still in flight, "open a message first" is simply false (#818).
 */
const MAILBOXES_NOT_LOADED = "The mailbox list hasn't loaded yet";

interface Press {
	action: MailAction;
	messageId: string | null;
}

export const MessageToolbar = ({
	hasThread,
	messageId,
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
	const [press, setPress] = useState<Press | null>(null);
	const canDeleteResolved = canDelete ?? hasThread;
	const actingOn = messageId ?? null;

	const whyUnavailable = (action: MailAction): string | null => {
		if (action === "delete") {
			if (!canDeleteResolved) return OPEN_FIRST;
			return onDelete ? null : NOT_LOADED_YET;
		}
		if (!hasThread) return OPEN_FIRST;
		if (action === "move") return moveContext ? null : MAILBOXES_NOT_LOADED;
		const handler = {
			reply: onReply,
			replyAll: onReplyAll,
			forward: onForward,
			flag: onToggleStar,
		}[action];
		return handler ? null : NOT_LOADED_YET;
	};

	// Derived rather than stored: the sentence is re-read from the press on every
	// render, so it leaves the moment its reason does — the handler arrives, the
	// thread opens, or the reader moves to another message.
	const hint =
		press && press.messageId === actingOn ? whyUnavailable(press.action) : null;

	const explain = (action: MailAction) => () =>
		setPress({ action, messageId: actingOn });
	// Every verb the bar renders answers a press, wired or not.
	const wired = (action: MailAction, handler: (() => void) | undefined) =>
		handler ?? explain(action);

	return (
		<MailActionToolbar
			hasThread={hasThread}
			isStarred={isStarred}
			onUnavailable={(action: MailAction) =>
				setPress({ action, messageId: actingOn })
			}
			unavailableHint={hint}
			replyTitle={`Reply ${tooltipForAction("reply")}`}
			replyAllTitle={`Reply all ${tooltipForAction("replyAll")}`}
			forwardTitle={`Forward ${tooltipForAction("forward")}`}
			deleteTitle={`Move to Trash ${tooltipForAction("delete")}`}
			flagTitle={`Star ${tooltipForAction("toggleStar")}`}
			onReply={wired("reply", onReply)}
			onReplyAll={wired("replyAll", onReplyAll)}
			onForward={wired("forward", onForward)}
			onDelete={
				canDeleteResolved ? wired("delete", onDelete) : explain("delete")
			}
			onToggleStar={wired("flag", onToggleStar)}
			onMove={explain("move")}
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
