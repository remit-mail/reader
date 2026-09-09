import {
	FolderInput,
	Forward,
	Reply,
	ReplyAll,
	Star,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

/** The verbs the reading-pane toolbar exposes. No archive: Remit is IMAP-backed
 *  and has no archive verb — the IMAP-native equivalent is move-to-folder. */
export type MailAction =
	| "reply"
	| "replyAll"
	| "forward"
	| "delete"
	| "move"
	| "flag";

export interface MailActionToolbarProps {
	/** Whether a thread is open. Drives the no-op-explain behaviour, never `disabled`. */
	hasThread: boolean;
	/**
	 * Fired when an action button is pressed and there is nothing behind it —
	 * no thread open, or no handler wired for that verb. The host surfaces a
	 * one-line inline explanation — never a toast, never a disabled button
	 * (`doc/rules/ux.md`: never disable a control).
	 */
	onUnavailable?: (action: MailAction) => void;
	/** A one-line inline notice rendered under the toolbar (e.g. "Open a message first"). */
	unavailableHint?: ReactNode;
	/**
	 * Whether the open message is starred. Undefined until the conversation
	 * says — the button then omits `aria-pressed` rather than announcing an
	 * unstarred state it does not know yet.
	 */
	isStarred?: boolean;
	/**
	 * Whether to render the triage cluster (move-to-trash / move / flag).
	 * Defaults to `true` for the desktop reading-pane toolbar. The mobile pane
	 * sets it `false` because its management bar already owns triage — rendering
	 * both would create duplicate accessible names.
	 */
	showTriage?: boolean;
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	onDelete?: () => void;
	onToggleStar?: () => void;
	/** Replaces the move button with a host-supplied trigger (e.g. the picker popover). */
	moveSlot?: ReactNode;
	onMove?: () => void;
	replyTitle?: string;
	replyAllTitle?: string;
	forwardTitle?: string;
	deleteTitle?: string;
	flagTitle?: string;
	/** Trailing content (search, compose, intelligence toggle, account menu). */
	children?: ReactNode;
	className?: string;
}

/**
 * The reading-pane action toolbar, shared between the remit-ui AppShell
 * reference and the live client. Buttons are always pressable: where a press
 * cannot act — no thread open, or no handler wired for that verb — it calls
 * `onUnavailable(action)` so the host can explain why, rather than greying out
 * (the never-disable tenet — a `disabled` button gives the user no path to
 * learn what it does or what they must do first). Every press is answered; the
 * bar has no branch that ends in silence.
 */
export function MailActionToolbar({
	hasThread,
	onUnavailable,
	unavailableHint,
	isStarred,
	showTriage = true,
	onReply,
	onReplyAll,
	onForward,
	onDelete,
	onToggleStar,
	moveSlot,
	onMove,
	replyTitle = "Reply (r)",
	replyAllTitle = "Reply all (a)",
	forwardTitle = "Forward (f)",
	deleteTitle = "Move to Trash (#)",
	flagTitle = "Star (s)",
	children,
	className,
}: MailActionToolbarProps) {
	// A verb with no handler behind it is unavailable in exactly the way one with
	// no thread is, and says so the same way. Dropping the press instead left the
	// three reply verbs pressable and mute for as long as a host took to wire
	// them (#803).
	const act = (action: MailAction, handler?: () => void) => () => {
		if (!hasThread || !handler) {
			onUnavailable?.(action);
			return;
		}
		handler();
	};

	return (
		<div className="relative">
			<header
				className={cn(
					"flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3",
					className,
				)}
			>
				<Button
					variant="ghost"
					size="sm"
					icon={<Reply className="size-4" />}
					title={replyTitle}
					aria-label="Reply"
					onClick={act("reply", onReply)}
				/>
				<Button
					variant="ghost"
					size="sm"
					icon={<ReplyAll className="size-4" />}
					title={replyAllTitle}
					aria-label="Reply all"
					onClick={act("replyAll", onReplyAll)}
				/>
				<Button
					variant="ghost"
					size="sm"
					icon={<Forward className="size-4" />}
					title={forwardTitle}
					aria-label="Forward"
					onClick={act("forward", onForward)}
				/>
				{showTriage && (
					<>
						<span className="mx-1 h-4 w-px bg-line" aria-hidden />
						<Button
							variant="ghost"
							size="sm"
							icon={<Trash2 className="size-4" />}
							title={deleteTitle}
							aria-label="Move to Trash"
							onClick={act("delete", onDelete)}
						/>
						{moveSlot ?? (
							<Button
								variant="ghost"
								size="sm"
								icon={<FolderInput className="size-4" />}
								title="Move to mailbox"
								aria-label="Move to mailbox"
								onClick={act("move", onMove)}
							/>
						)}
						<Button
							variant="ghost"
							size="sm"
							icon={
								<Star
									className={cn(
										"size-4",
										isStarred && "fill-warning text-warning",
									)}
								/>
							}
							title={flagTitle}
							aria-label="Star"
							aria-pressed={isStarred}
							onClick={act("flag", onToggleStar)}
						/>
					</>
				)}
				<div className="flex-1" />
				{children}
			</header>
			{unavailableHint && (
				// biome-ignore lint/a11y/useSemanticElements: <p> with role="status" preserves block layout; <output> is inline
				<p
					role="status"
					className="border-b border-line bg-surface-sunken px-3 py-1 text-2xs text-fg-subtle"
				>
					{unavailableHint}
				</p>
			)}
		</div>
	);
}
