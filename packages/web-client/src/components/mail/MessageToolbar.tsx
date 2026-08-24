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
	/**
	 * The intelligence drawer is up, and its scrim covers this toolbar (#747).
	 * The toggle is lifted above that scrim so the control that opened the
	 * modal can still act on it — closing what it opened — while every other
	 * verb stays where the scrim put it, out of reach.
	 */
	intelligenceElevated?: boolean;

	/* ---- wired action callbacks (omit to keep the no-op-explain behaviour) ---- */
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	/** Delete all messages in the open thread. */
	onDelete?: () => void;
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
	/**
	 * Whether the lookup behind `moveContext` is still in flight. Absent context
	 * is either a read that has not landed or one that settled holding nothing,
	 * and the two owe the reader different sentences (#818).
	 */
	moveContextLoading?: boolean;
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
const MAILBOXES_LOADING = "The mailbox list hasn't loaded yet";

/** The same read, settled and holding no account for this mailbox: it errored,
 *  or no account lists the folder. Waiting will not fix either one. */
const MAILBOXES_MISSING =
	"Couldn't find this mailbox's account — reload to try again";

/** The accessible name of each verb's button, for the sentence that invites a
 *  press to be repeated once what it waited for arrives. */
const LABELS: Record<MailAction, string> = {
	reply: "Reply",
	replyAll: "Reply all",
	forward: "Forward",
	delete: "Move to Trash",
	move: "Move to mailbox",
	flag: "Star",
};

interface Press {
	action: MailAction;
	messageId: string | null;
	/** Whether a thread was open when the press was made. A Move made over an
	 *  open message is carried into the picker; one made over an empty pane
	 *  asked for nothing that could still arrive. */
	overThread: boolean;
}

export const MessageToolbar = ({
	hasThread,
	messageId,
	intelligenceOpen,
	canToggleIntelligence,
	intelligenceElevated,
	onToggleIntelligence,
	onReply,
	onReplyAll,
	onForward,
	onDelete,
	onToggleStar,
	isStarred,
	moveContext,
	moveContextLoading,
}: MessageToolbarProps) => {
	const [press, setPress] = useState<Press | null>(null);
	const actingOn = messageId ?? null;

	// The one place availability is decided. It agrees with `MailActionToolbar`
	// by construction — a null reason implies both a thread and a handler, which
	// is exactly what the shared bar requires before it calls one — so no press
	// can fall between the two and end in silence.
	const whyUnavailable = (action: MailAction): string | null => {
		if (!hasThread) return OPEN_FIRST;
		if (action === "move") {
			if (moveContext) return null;
			return moveContextLoading ? MAILBOXES_LOADING : MAILBOXES_MISSING;
		}
		const handler = {
			reply: onReply,
			replyAll: onReplyAll,
			forward: onForward,
			delete: onDelete,
			flag: onToggleStar,
		}[action];
		return handler ? null : NOT_LOADED_YET;
	};

	// Derived rather than stored: the sentence is re-read from the press on every
	// render, so it leaves the moment its reason does. What it leaves behind is
	// an invitation, not nothing — the press was made and never acted on.
	const pressed = press && press.messageId === actingOn ? press : null;
	const reason = pressed ? whyUnavailable(pressed.action) : null;
	// Move is the exception: its press is carried into the picker below, which
	// mounts already open, so there is nothing left to ask for.
	const carriedMove =
		pressed?.action === "move" && pressed.overThread && Boolean(moveContext);
	const hint =
		reason ??
		(pressed && !carriedMove
			? `${LABELS[pressed.action]} is ready — press it again`
			: null);

	const record = (action: MailAction) =>
		setPress({ action, messageId: actingOn, overThread: hasThread });
	const explain = (action: MailAction) => () => record(action);
	// Every verb the bar renders answers a press, wired or not — and a press
	// that acts takes down whatever an earlier one left behind, so a stale
	// complaint never reads as this verb's failure.
	const wired = (action: MailAction, handler: (() => void) | undefined) =>
		handler
			? () => {
					setPress(null);
					handler();
				}
			: explain(action);

	return (
		<MailActionToolbar
			hasThread={hasThread}
			isStarred={isStarred}
			onUnavailable={record}
			unavailableHint={hint}
			replyTitle={`Reply ${tooltipForAction("reply")}`}
			replyAllTitle={`Reply all ${tooltipForAction("replyAll")}`}
			forwardTitle={`Forward ${tooltipForAction("forward")}`}
			deleteTitle={`Move to Trash ${tooltipForAction("delete")}`}
			flagTitle={`Star ${tooltipForAction("toggleStar")}`}
			onReply={wired("reply", onReply)}
			onReplyAll={wired("replyAll", onReplyAll)}
			onForward={wired("forward", onForward)}
			onDelete={wired("delete", onDelete)}
			onToggleStar={wired("flag", onToggleStar)}
			onMove={explain("move")}
			moveSlot={
				moveContext ? (
					<MoveToTrigger
						accountId={moveContext.accountId}
						currentMailboxId={moveContext.currentMailboxId}
						onMove={moveContext.onMove}
						label="Move to mailbox"
						defaultOpen={carriedMove}
					/>
				) : undefined
			}
		>
			<IntelligenceToggle
				open={intelligenceOpen}
				enabled={canToggleIntelligence}
				onToggle={onToggleIntelligence}
				className={intelligenceElevated ? "relative z-[60]" : undefined}
			/>
		</MailActionToolbar>
	);
};
