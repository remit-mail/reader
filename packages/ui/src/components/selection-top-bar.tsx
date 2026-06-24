import { Loader2, MailOpen, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button.js";

export interface SelectionTopBarProps {
	count: number;
	onCancel: () => void;
	onDelete: () => void;
	/** Optional — hide the mark-read button when omitted. */
	onMarkRead?: () => void;
	/**
	 * Slot for a move-to-folder trigger. Rendered between mark-read and delete.
	 * Kept as a render prop so the caller controls API dependencies.
	 */
	moveSlot?: ReactNode;
	/**
	 * Cross-account hint surfaced below the action row. When set, Move is
	 * expected to be suppressed by the caller (via moveSlot).
	 */
	moveDisabledHint?: string;
	/**
	 * True while a delete or move mutation is in flight. The delete button
	 * shows a spinner; other actions no-op. Never disables controls.
	 */
	isBusy?: boolean;
}

/**
 * Replaces the list header in narrow-width multi-select: a count plus the bulk
 * verbs (cancel, mark read, move, delete). Real Buttons that never disable.
 */
export function SelectionTopBar({
	count,
	onCancel,
	onMarkRead,
	onDelete,
	moveSlot,
	moveDisabledHint,
	isBusy = false,
}: SelectionTopBarProps) {
	return (
		<header className="flex shrink-0 flex-col border-b border-line bg-surface-sunken">
			<div className="flex h-pane-header items-center gap-2 px-row-inset">
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-4" />}
					onClick={onCancel}
					aria-label="Cancel selection"
					className="-ml-1 shrink-0"
				/>
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
					{count} {count === 1 ? "message" : "messages"} selected
				</span>
				{onMarkRead && (
					<Button
						variant="ghost"
						size="sm"
						icon={<MailOpen className="size-4" />}
						onClick={isBusy ? undefined : onMarkRead}
						aria-label="Mark as read"
						aria-busy={isBusy || undefined}
						className="shrink-0"
					/>
				)}
				{moveSlot}
				<Button
					variant="ghost"
					size="sm"
					icon={
						isBusy ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Trash2 className="size-4 text-danger" />
						)
					}
					onClick={isBusy ? undefined : onDelete}
					aria-label="Delete selected messages"
					aria-busy={isBusy || undefined}
					className="shrink-0"
				/>
			</div>
			{moveDisabledHint && (
				<p
					className="px-row-inset pb-2 text-xs text-fg-muted"
					role="status"
					aria-live="polite"
				>
					{moveDisabledHint}
				</p>
			)}
		</header>
	);
}
