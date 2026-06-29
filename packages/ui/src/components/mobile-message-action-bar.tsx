import {
	Forward,
	Mail,
	MailOpen,
	Reply,
	ReplyAll,
	Star,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import { PopoverMenu, type PopoverMenuItem } from "./popover-menu.js";

export type MobileMessageAction =
	| "reply"
	| "replyAll"
	| "forward"
	| "star"
	| "delete"
	| "toggleRead";

export interface MobileMessageActionBarProps {
	/** Whether a message is open. Gates the verbs (never disables). */
	hasThread: boolean;
	/* ---- Reply verbs ----
	 * Per-message: replying targets the message this bar belongs to. Omit a
	 * handler to drop that verb. */
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	isStarred?: boolean;
	onToggleStar?: () => void;
	onDelete?: () => void;
	isRead?: boolean;
	onToggleRead?: () => void;
	/**
	 * Move-to-folder trigger. The kit owns the bar layout; the app supplies the
	 * picker trigger so the kit needn't depend on folder data. Sized to match the
	 * bar's touch buttons by the caller.
	 */
	moveSlot?: ReactNode;
	/** Extra overflow rows appended after mark read/unread. */
	overflowItems?: PopoverMenuItem[];
	/** Fired when a verb is pressed with no message open, so the host can explain. */
	onUnavailable?: (action: MobileMessageAction) => void;
	/** One-line inline notice rendered under the bar when no message is open. */
	unavailableHint?: ReactNode;
	className?: string;
}

const TOUCH = "min-h-11 min-w-11 px-0";

/**
 * The per-message action bar for the narrow-width (single-pane) reading view.
 * It belongs to one expanded message and owns that message's verbs — reply /
 * reply-all / forward on the left, then star, move, delete and the overflow
 * (mark read/unread) on the right — so reply targets this message and nothing
 * repeats it. Intelligence is not here: it lives once in the top app bar and
 * reflects the active message. No archive either — Remit is IMAP-backed and
 * IMAP has no archive concept. Built from the kit `Button`, `PopoverMenu` and a
 * caller-supplied `moveSlot`; buttons stay pressable with no message open and
 * call `onUnavailable` rather than greying out.
 */
export function MobileMessageActionBar({
	hasThread,
	onReply,
	onReplyAll,
	onForward,
	isStarred,
	onToggleStar,
	onDelete,
	isRead,
	onToggleRead,
	moveSlot,
	overflowItems = [],
	onUnavailable,
	unavailableHint,
	className,
}: MobileMessageActionBarProps) {
	const act = (action: MobileMessageAction, handler?: () => void) => () => {
		if (!hasThread) {
			onUnavailable?.(action);
			return;
		}
		handler?.();
	};

	const readItem: PopoverMenuItem[] = onToggleRead
		? [
				{
					key: "toggle-read",
					label: isRead ? "Mark as unread" : "Mark as read",
					icon: isRead ? (
						<Mail className="size-4" />
					) : (
						<MailOpen className="size-4" />
					),
					onSelect: act("toggleRead", onToggleRead),
				},
			]
		: [];

	return (
		<div className={cn("relative", className)}>
			<div className="flex h-12 shrink-0 items-center gap-0.5 border-y border-line bg-canvas px-1">
				<Button
					variant="ghost"
					size="sm"
					icon={<Reply className="size-5" />}
					onClick={act("reply", onReply)}
					aria-label="Reply"
					title="Reply"
					className={TOUCH}
				/>
				<Button
					variant="ghost"
					size="sm"
					icon={<ReplyAll className="size-5" />}
					onClick={act("replyAll", onReplyAll)}
					aria-label="Reply all"
					title="Reply all"
					className={TOUCH}
				/>
				<Button
					variant="ghost"
					size="sm"
					icon={<Forward className="size-5" />}
					onClick={act("forward", onForward)}
					aria-label="Forward"
					title="Forward"
					className={TOUCH}
				/>
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="sm"
					icon={
						<Star
							className={cn("size-5", isStarred && "fill-warning text-warning")}
						/>
					}
					onClick={act("star", onToggleStar)}
					aria-label={isStarred ? "Remove flag" : "Flag"}
					aria-pressed={isStarred}
					title={isStarred ? "Remove flag" : "Flag"}
					className={TOUCH}
				/>
				{moveSlot}
				<Button
					variant="ghost"
					size="sm"
					icon={<Trash2 className="size-5" />}
					onClick={act("delete", onDelete)}
					aria-label="Move to Trash"
					title="Move to Trash"
					className={TOUCH}
				/>
				<PopoverMenu
					triggerLabel="More actions"
					items={[...readItem, ...overflowItems]}
				/>
			</div>
			{!hasThread && unavailableHint && (
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
