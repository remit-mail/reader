import { MailOpen, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoveToTrigger } from "./MoveToTrigger";

interface MobileSelectionTopBarProps {
	selectedCount: number;
	onCancel: () => void;
	onDelete: () => void;
	onMarkAsRead?: () => void;
	onMove?: (destinationMailboxId: string) => void;
	/**
	 * True while a delete or move mutation is in flight. Disables the
	 * action buttons so quick taps can't queue overlapping optimistic
	 * patches before the previous one settles.
	 */
	isBusy?: boolean;
	/**
	 * Owning account for the current mailbox view. Required to scope the
	 * Move-to-folder bottom sheet. Move stays hidden if either this or
	 * `onMove` is missing.
	 */
	accountId?: string;
	currentMailboxId?: string;
	/**
	 * When the selection spans multiple accounts the top bar disables Move
	 * and surfaces this hint inline. Cross-account moves aren't supported —
	 * the user must clear or narrow the selection first.
	 */
	moveDisabledHint?: string;
}

/**
 * Mobile-specific top bar shown during multi-select mode.
 * All buttons have 44px minimum touch targets.
 */
export const MobileSelectionTopBar = ({
	selectedCount,
	onCancel,
	onDelete,
	onMarkAsRead,
	onMove,
	isBusy = false,
	accountId,
	currentMailboxId,
	moveDisabledHint,
}: MobileSelectionTopBarProps) => {
	const canShowMove = !!onMove && !!accountId && !!currentMailboxId;
	return (
		<div className="sticky top-0 z-10 flex flex-col gap-1 px-3 py-2 bg-surface-sunken/50 border-b border-line">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onCancel}
						className="min-h-11 min-w-11 inline-flex items-center justify-center rounded hover:bg-surface-raised transition-colors"
						aria-label="Cancel selection"
					>
						<X className="size-4 text-fg-muted" />
					</button>
					<span className="text-sm font-medium">
						{selectedCount} {selectedCount === 1 ? "message" : "messages"}{" "}
						selected
					</span>
				</div>
				<div className="flex items-center gap-1">
					{onMarkAsRead && (
						<button
							type="button"
							onClick={onMarkAsRead}
							disabled={isBusy}
							className="min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sm font-medium transition-colors hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
							aria-label="Mark as read"
						>
							<MailOpen className="size-4" />
						</button>
					)}
					{canShowMove && onMove && accountId && currentMailboxId && (
						<MoveToTrigger
							accountId={accountId}
							currentMailboxId={currentMailboxId}
							onMove={onMove}
							disabled={isBusy}
							disabledHint={moveDisabledHint}
							label="Move selected messages"
						/>
					)}
					<button
						type="button"
						onClick={onDelete}
						disabled={isBusy}
						className={cn(
							"min-h-11 min-w-11 inline-flex items-center justify-center rounded text-sm font-medium transition-colors hover:bg-surface-raised",
							"text-danger",
							"disabled:opacity-50 disabled:cursor-not-allowed",
						)}
						aria-label="Delete selected messages"
					>
						<Trash2 className="size-4" />
					</button>
				</div>
			</div>
			{moveDisabledHint && (
				<p className="text-xs text-fg-muted" role="status" aria-live="polite">
					{moveDisabledHint}
				</p>
			)}
		</div>
	);
};
