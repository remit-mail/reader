import { Banner, type BannerTone, Checkbox, ProgressBar } from "@remit/ui";
import { Loader2, MailOpen, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MoveToTrigger } from "./MoveToTrigger";

export interface SelectionToolbarNotice {
	tone: BannerTone;
	text: string;
	action?: { label: string; onClick: () => void };
}

interface SelectionToolbarProps {
	selectedCount: number;
	onDelete: () => void;
	onClearSelection: () => void;
	onMarkAsRead?: () => void;
	onMove?: (destinationMailboxId: string) => void;
	/**
	 * Open the smart-organize flow for the current selection. Rendered only
	 * when a single-account move target is resolvable (same guard as Move) —
	 * organize is account-scoped.
	 */
	onOrganize?: () => void;
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
	/**
	 * Select-all-loaded control, rendered between the clear button and the
	 * count. Presence renders the checkbox; `indeterminate` is the some-selected
	 * tri-state. Wired only while searching, where escalating past the loaded
	 * page is possible (issue #212).
	 */
	selectAll?: {
		checked: boolean;
		indeterminate?: boolean;
		onChange: () => void;
	};
	/**
	 * Overrides the "{count} messages selected" text. Names the scope once it is
	 * anything other than a materialized selection — an escalated predicate
	 * ("All 3,412 matching \"npm\" selected"), a running count ("Counting… 1,900
	 * so far"), or bulk-run progress ("Deleting 1,200 of 3,412…").
	 */
	statusLabel?: string;
	/**
	 * True while a search result set is still paging to its total. Hides Delete
	 * (and Move) — the count they would act on isn't known yet.
	 */
	isCounting?: boolean;
	/**
	 * Determinate progress for a chunked/escalated run in flight. Renders a
	 * `ProgressBar` below the action row and takes the verbs off screen — the
	 * bar is the only thing that can act mid-run.
	 */
	progress?: { value: number; max: number; tone?: BannerTone };
	/**
	 * At-most-one toned status line below the action row, optionally carrying an
	 * action button — the "Select all N matching…" escalation offer, a "Stop"
	 * during counting, a "Clear selection" once escalated, or a partial-failure
	 * "Retry N" (issue #212).
	 */
	notice?: SelectionToolbarNotice;
}

export const SelectionToolbar = ({
	selectedCount,
	onDelete,
	onClearSelection,
	onMarkAsRead,
	onMove,
	onOrganize,
	isDeleting = false,
	isMoving = false,
	accountId,
	currentMailboxId,
	moveDisabledHint,
	selectAll,
	statusLabel,
	isCounting = false,
	progress,
	notice,
}: SelectionToolbarProps) => {
	if (selectedCount === 0) return null;

	// A chunked/escalated run owns the bar: the progress bar is the only signal
	// that can act, so the verbs come off screen until it ends (issue #212).
	const isRunning = progress !== undefined;
	const isBusy = isDeleting || isMoving || isRunning;
	// The verbs are suppressed while a run is in flight or a count is still
	// paging; an escalated-but-idle selection keeps every verb (verb parity).
	const showVerbs = !isRunning && !isCounting;

	const canShowMove = !!onMove && !!accountId && !!currentMailboxId;
	// Organize has no escalated-predicate path — it acts on the materialized
	// selection — so it's withdrawn the moment the selection escalates or a run
	// takes over (any state that names itself through `statusLabel`).
	const canShowOrganize =
		!!onOrganize &&
		!!accountId &&
		!!currentMailboxId &&
		!moveDisabledHint &&
		!statusLabel;

	const defaultLabel = selectAll?.checked
		? `All ${selectedCount} loaded selected`
		: `${selectedCount} ${selectedCount === 1 ? "message" : "messages"} selected`;

	return (
		<div className="sticky top-0 z-10 flex flex-col bg-surface-sunken border-b border-line">
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={onClearSelection}
						className="min-h-11 min-w-11 inline-flex items-center justify-center rounded hover:bg-surface-raised transition-colors"
						aria-label="Clear selection"
					>
						<X className="size-4 text-fg-muted" />
					</button>
					{selectAll && (
						// biome-ignore lint/a11y/noLabelWithoutControl: the label wraps Checkbox's own input, giving the 20px control a 44px hit area
						<label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
							<Checkbox
								aria-label="Select all"
								checked={selectAll.checked}
								indeterminate={selectAll.indeterminate}
								onChange={selectAll.onChange}
							/>
						</label>
					)}
					<span className="text-sm font-medium">
						{statusLabel ?? defaultLabel}
					</span>
					{moveDisabledHint && !notice && (
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
					{canShowOrganize && onOrganize && (
						<button
							type="button"
							onClick={isBusy ? undefined : onOrganize}
							className="min-h-11 inline-flex items-center justify-center gap-1.5 px-3 rounded text-sm font-medium transition-colors hover:bg-surface-raised"
							aria-label="Organize similar messages"
						>
							<Sparkles className="size-4" />
							<span className="hidden sm:inline">Organize</span>
						</button>
					)}
					{showVerbs && onMarkAsRead && (
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
					{showVerbs &&
						canShowMove &&
						onMove &&
						accountId &&
						currentMailboxId && (
							<MoveToTrigger
								accountId={accountId}
								currentMailboxId={currentMailboxId}
								onMove={isBusy ? () => {} : onMove}
								disabledHint={moveDisabledHint}
								variant="icon-only"
								label="Move selected messages"
							/>
						)}
					{showVerbs && (
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
					)}
				</div>
			</div>
			{progress && (
				<div className="px-3 pb-2">
					<ProgressBar
						value={progress.value}
						max={progress.max}
						tone={progress.tone}
					/>
				</div>
			)}
			{notice && (
				<Banner
					tone={notice.tone}
					variant="soft"
					role="status"
					aria-live="polite"
					className="mx-3 mb-2"
				>
					<div className="flex items-center justify-between gap-2">
						{notice.text && <span>{notice.text}</span>}
						{notice.action && (
							<button
								type="button"
								onClick={notice.action.onClick}
								className="-my-1 min-h-11 shrink-0 inline-flex items-center px-3 rounded text-sm font-medium transition-colors hover:bg-surface-raised"
							>
								{notice.action.label}
							</button>
						)}
					</div>
				</Banner>
			)}
		</div>
	);
};
