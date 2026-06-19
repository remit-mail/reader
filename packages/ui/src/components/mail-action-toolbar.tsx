import {
	Archive,
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

/** The verbs the reading-pane toolbar exposes. */
export type MailAction =
	| "reply"
	| "replyAll"
	| "forward"
	| "archive"
	| "delete"
	| "move"
	| "flag";

export interface MailActionToolbarProps {
	/** Whether a thread is open. Drives the no-op-explain behaviour, never `disabled`. */
	hasThread: boolean;
	/**
	 * Fired when an action button is pressed with no thread open. The host
	 * surfaces a one-line inline explanation — never a toast, never a disabled
	 * button (`doc/rules/ux.md`: never disable a control).
	 */
	onUnavailable?: (action: MailAction) => void;
	/** A one-line inline notice rendered under the toolbar (e.g. "Open a message first"). */
	unavailableHint?: ReactNode;
	isStarred?: boolean;
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	onArchive?: () => void;
	onDelete?: () => void;
	onToggleStar?: () => void;
	/** Replaces the move button with a host-supplied trigger (e.g. the picker popover). */
	moveSlot?: ReactNode;
	onMove?: () => void;
	replyTitle?: string;
	replyAllTitle?: string;
	forwardTitle?: string;
	archiveTitle?: string;
	deleteTitle?: string;
	flagTitle?: string;
	/** Trailing content (search, compose, intelligence toggle, account menu). */
	children?: ReactNode;
	className?: string;
}

/**
 * The reading-pane action toolbar, shared between the remit-ui AppShell
 * reference and the live client. Buttons are always pressable: with no thread
 * open they no-op and call `onUnavailable(action)` so the host can explain why,
 * rather than greying out (the never-disable tenet — a `disabled` button gives
 * the user no path to learn what it does or what they must do first).
 */
export function MailActionToolbar({
	hasThread,
	onUnavailable,
	unavailableHint,
	isStarred,
	onReply,
	onReplyAll,
	onForward,
	onArchive,
	onDelete,
	onToggleStar,
	moveSlot,
	onMove,
	replyTitle = "Reply (r)",
	replyAllTitle = "Reply all (a)",
	forwardTitle = "Forward (f)",
	archiveTitle = "Archive (e)",
	deleteTitle = "Move to Trash (#)",
	flagTitle = "Flag (s)",
	children,
	className,
}: MailActionToolbarProps) {
	const act = (action: MailAction, handler?: () => void) => () => {
		if (!hasThread) {
			onUnavailable?.(action);
			return;
		}
		handler?.();
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
				<span className="mx-1 h-4 w-px bg-line" aria-hidden />
				<Button
					variant="ghost"
					size="sm"
					icon={<Archive className="size-4" />}
					title={archiveTitle}
					aria-label="Archive"
					onClick={act("archive", onArchive)}
				/>
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
							className={cn("size-4", isStarred && "fill-warning text-warning")}
						/>
					}
					title={flagTitle}
					aria-label="Flag"
					onClick={act("flag", onToggleStar)}
				/>
				<div className="flex-1" />
				{children}
			</header>
			{!hasThread && unavailableHint && (
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
