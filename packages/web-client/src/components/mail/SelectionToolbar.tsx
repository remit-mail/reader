import { Loader2, MailOpen, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoveToTrigger } from "./MoveToTrigger";

interface SelectionToolbarProps {
	selectedCount: number;
	onDelete: () => void;
	onClearSelection: () => void;
	onMarkAsRead?: () => void;
	onMove?: (destinationMailboxId: string) => void;
	isDeleting?: boolean;
	/**
	 * True while a move mutation is in flight. Action buttons no-op while
	 * busy — never disabled.
	 */
	isMoving?: boolean;
	/**
	 * Owning account for the current mailbox view. Required to scope the
	 * Move-to-folder picker. The Move button only renders when both
	 * `onMove` and `accountId` are present.
	 */
	accountId?: string;
	currentMailboxId?: string;
	/**
	 * When the user's selection spans multiple accounts the toolbar
	 * disables Move and surfaces this hint inline next to the button.
	 * Move only works within one account.
	 */
	moveDisabledHint?: string;
}

export const SelectionToolbar = ({
	selectedCount,
	onDelete,
	onClearSelection,
	onMarkAsRead,
	onMove,
	isDeleting = false,
	isMoving = false,
	accountId,
	currentMailboxId,
	moveDisabledHint,
}: SelectionToolbarProps) => {
	const isBusy = isDeleting || isMoving;
	if (selectedCount === 0) return null;

	const canShowMove = !!onMove && !!accountId && !!currentMailboxId;

	return (
		<div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-surface-sunken border-b border-line">
			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={onClearSelection}
					className="min-h-11 min-w-11 inline-flex items-center justify-center rounded hover:bg-surface-raised transition-colors"
					aria-label="Clear selection"
				>
					<X className="size-4 text-fg-muted" />
				</button>
				<span className="text-sm font-medium">
					{selectedCount} {selectedCount === 1 ? "message" : "messages"}{" "}
					selected
				</span>
				{moveDisabledHint && (
					// biome-ignore lint/a11y/useSemanticElements: <span> with role="status" keeps inline layout; <output> would shift flow
					<span
						className="text-xs text-fg-muted"
						role="status"
						aria-live="polite"
					>
						{moveDisabledHint}
					</span>
				)}
			</div>
			<div className="flex items-center gap-1">
				{onMarkAsRead && (
					<button
						type="button"
						onClick={isBusy ? undefined : onMarkAsRead}
						className="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sm font-medium transition-colors hover:bg-surface-raised"
						aria-label="Mark as read"
						aria-busy={isBusy}
					>
						<MailOpen className="size-4" />
					</button>
				)}
				{canShowMove && onMove && accountId && currentMailboxId && (
					<MoveToTrigger
						accountId={accountId}
						currentMailboxId={currentMailboxId}
						onMove={isBusy ? () => {} : onMove}
						disabledHint={moveDisabledHint}
						variant="icon-only"
						label="Move selected messages"
					/>
				)}
				<button
					type="button"
					onClick={isBusy ? undefined : onDelete}
					className={cn(
						"min-h-11 min-w-11 inline-flex items-center justify-center gap-1.5 px-3 rounded text-sm font-medium transition-colors",
						"bg-danger text-canvas hover:bg-danger/90",
					)}
					aria-label="Delete selected messages"
					aria-busy={isDeleting}
				>
					{isDeleting ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Trash2 className="size-4" />
					)}
					<span className="hidden sm:inline">
						{isDeleting ? "Deleting..." : "Delete"}
					</span>
				</button>
			</div>
		</div>
	);
};
