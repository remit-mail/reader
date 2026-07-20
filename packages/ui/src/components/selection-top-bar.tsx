import { Loader2, MailOpen, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Banner, type BannerTone } from "./banner.js";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import { ProgressBar } from "./progress-bar.js";

const formatCount = (n: number): string => n.toLocaleString();

export interface SelectionTopBarNoticeAction {
	label: string;
	onClick: () => void;
}

export interface SelectionTopBarNotice {
	tone: BannerTone;
	text: string;
	action?: SelectionTopBarNoticeAction;
}

export interface SelectionTopBarProps {
	count: number;
	onCancel: () => void;
	onDelete: () => void;
	/** Optional — hide the mark-read button when omitted, or while `isBusy`. */
	onMarkRead?: () => void;
	/**
	 * Slot for a move-to-folder trigger. Rendered between mark-read and delete.
	 * Kept as a render prop so the caller controls API dependencies.
	 */
	moveSlot?: ReactNode;
	/**
	 * True while a delete or move mutation is in flight. The delete button
	 * shows a spinner and mark-read is hidden (never disabled — nothing here
	 * disables, states that can't act are hidden instead).
	 */
	isBusy?: boolean;
	/**
	 * True while a search result set is still paging to find its total. Hides
	 * delete — the count it would act on isn't known yet.
	 */
	isCounting?: boolean;
	/**
	 * Select-all control rendered between cancel and the count label. Presence
	 * of this prop is what renders the checkbox — omit it for a bar with no
	 * select-all affordance. `indeterminate` renders the some-selected tri-state
	 * (`Checkbox`'s dash), `checked` is the all-selected state. The checkbox
	 * itself stays visually small; a wrapping 44px hit area makes it tappable.
	 */
	selectAll?: {
		checked: boolean;
		indeterminate?: boolean;
		onChange: () => void;
	};
	/**
	 * Overrides the default "{count} messages selected" text. Required once the
	 * count's scope is anything other than "every loaded row is selected" —
	 * an escalated selection ("All 3,412 matching \"npm\" selected"), a
	 * counting state ("Counting… 1,900 so far"), or bulk-delete progress
	 * ("Deleting 1,200 of 3,412…"). When `selectAll.checked` is true and this
	 * is omitted, the default text names the loaded-scope itself ("All 47
	 * loaded selected") rather than a bare count — a ticked select-all box
	 * next to a bare number reads as "everything", which is only true for the
	 * escalated case.
	 */
	statusLabel?: string;
	/**
	 * Determinate progress for a bulk operation in flight (e.g. a chunked
	 * delete). Renders a `ProgressBar` below the action row. Independent of
	 * `notice` — a caller can show progress and a notice at the same time.
	 */
	progress?: { value: number; max: number; tone?: BannerTone };
	/**
	 * Toned status line below the action row, sometimes carrying an action
	 * button — a cross-account move restriction, a "Select all N matching…"
	 * escalation, a "Stop" during counting, or a partial-failure "Retry N".
	 * Replaces the old `moveDisabledHint`/`failureHint` pair: a caller shows
	 * at most one notice at a time.
	 */
	notice?: SelectionTopBarNotice;
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
	isBusy = false,
	isCounting = false,
	selectAll,
	statusLabel,
	progress,
	notice,
}: SelectionTopBarProps) {
	const defaultLabel = selectAll?.checked
		? `All ${formatCount(count)} loaded selected`
		: `${formatCount(count)} ${count === 1 ? "message" : "messages"} selected`;

	return (
		<header className="flex shrink-0 flex-col border-b border-line bg-surface-sunken">
			<div className="flex h-pane-header items-center gap-2 px-row-inset">
				<Button
					variant="ghost"
					size="touch"
					icon={<X className="size-4" />}
					onClick={onCancel}
					aria-label="Cancel selection"
					className="-ml-2 shrink-0"
				/>
				{selectAll && (
					// biome-ignore lint/a11y/noLabelWithoutControl: label wraps Checkbox's own input, giving the 20px control a real 44px hit area
					<label className="-ml-1.5 flex size-11 shrink-0 cursor-pointer items-center justify-center">
						<Checkbox
							aria-label="Select all"
							checked={selectAll.checked}
							indeterminate={selectAll.indeterminate}
							onChange={selectAll.onChange}
						/>
					</label>
				)}
				<span
					className="min-w-0 flex-1 truncate text-sm font-medium text-fg"
					role="status"
					aria-live="polite"
				>
					{statusLabel ?? defaultLabel}
				</span>
				{onMarkRead && !isBusy && (
					<Button
						variant="ghost"
						size="touch"
						icon={<MailOpen className="size-4" />}
						onClick={onMarkRead}
						aria-label="Mark as read"
						className="shrink-0"
					/>
				)}
				{moveSlot}
				{!isCounting && (
					<Button
						variant="ghost"
						size="touch"
						icon={
							isBusy ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<Trash2 className="size-4 text-danger" />
							)
						}
						onClick={isBusy ? undefined : onDelete}
						aria-label="Move selected messages to Trash"
						aria-busy={isBusy || undefined}
						className="ml-4 shrink-0"
					/>
				)}
			</div>
			{progress && (
				<div className="px-row-inset pb-2">
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
					className="mx-row-inset mb-2"
				>
					<div className="flex items-center justify-between gap-2">
						{notice.text && <span>{notice.text}</span>}
						{notice.action && (
							<Button
								variant="ghost"
								size="md"
								onClick={notice.action.onClick}
								className="-my-1 min-h-11 shrink-0"
							>
								{notice.action.label}
							</Button>
						)}
					</div>
				</Banner>
			)}
		</header>
	);
}
