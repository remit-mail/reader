import {
	ArrowLeft,
	Loader2,
	MailOpen,
	ShieldAlert,
	Sparkles,
	Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Banner, type BannerTone } from "./banner.js";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import { PopoverMenu, type PopoverMenuItem } from "./popover-menu.js";
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

export interface SelectionTopBarSelectAll {
	checked: boolean;
	indeterminate?: boolean;
	onChange: () => void;
}

export interface SelectionTopBarProps {
	/** Names the surface while nothing is ticked — the mailbox, the brief. */
	title: string;
	count: number;
	/** Leaves selection, from the back arrow at the head of the bar. */
	onCancel: () => void;
	onDelete: () => void;
	/** Opens Organize for the selection. Omitted where organize cannot be
	 *  scoped to one account. */
	onOrganize?: () => void;
	/** Moves the selection to Junk. Omitted in Junk itself, or with no Junk
	 *  folder appointed. */
	onJunk?: () => void;
	/** Optional — dropped from the overflow menu while `isBusy`. */
	onMarkRead?: () => void;
	/**
	 * The Move verb. A render prop because the trigger owns the folder picker
	 * and its API dependencies; the bar only gives it a place in the verb row.
	 */
	moveSlot?: ReactNode;
	/**
	 * Extra rows at the foot of the overflow menu — the apply-label picker,
	 * whose list belongs to the account rather than to the bar. Withdrawn while
	 * `isBusy` or `isCounting`, like the other overflow verbs.
	 */
	overflowSlot?: ReactNode;
	/**
	 * True while a delete or move mutation is in flight. Delete shows a spinner
	 * and every other verb drops out — nothing here disables, states that
	 * cannot act are hidden instead.
	 */
	isBusy?: boolean;
	/**
	 * True while a search result set is still paging to find its total. Hides
	 * the verbs — the count they would act on isn't known yet.
	 */
	isCounting?: boolean;
	/**
	 * The labelled select-all control. Inline in the bar from 768px up, whether
	 * or not anything is ticked; below that it takes a second row while
	 * selecting, so row one stays a count and a row of verbs. `indeterminate`
	 * renders the some-selected tri-state.
	 */
	selectAll?: SelectionTopBarSelectAll;
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
	 */
	notice?: SelectionTopBarNotice;
}

/** Words, not a bare box: a tick with no legend never says what "all" covers. */
function SelectAllToggle({
	selectAll,
	selecting,
	className,
}: {
	selectAll: SelectionTopBarSelectAll;
	selecting: boolean;
	className: string;
}) {
	return (
		<Checkbox
			className={className}
			checked={selectAll.checked}
			indeterminate={selectAll.indeterminate}
			onChange={selectAll.onChange}
			label={
				<span className="font-medium text-accent">
					{selectAll.checked && selecting ? "Deselect all" : "Select all"}
				</span>
			}
		/>
	);
}

/**
 * The list header and the selection action bar, as one surface. With nothing
 * ticked it names the mailbox; from the first ticked row it carries the count
 * and the verbs in place of that title, in the same place at the top of the
 * pane.
 *
 * Delete, Move and Organize carry a glyph; Junk, Mark read and whatever
 * `overflowSlot` adds live in the overflow menu. Select-all is a labelled control — permanent from 768px up,
 * where row one has the room to carry it, and a second row below that, where
 * row one is a count and the verbs. A back arrow leaves selection at every
 * width, so a partial selection is always one press from being dropped.
 */
export function SelectionTopBar({
	title,
	count,
	onCancel,
	onDelete,
	onOrganize,
	onJunk,
	onMarkRead,
	moveSlot,
	overflowSlot,
	isBusy = false,
	isCounting = false,
	selectAll,
	statusLabel,
	progress,
	notice,
}: SelectionTopBarProps) {
	const selecting = count > 0 || isCounting;
	const defaultLabel = selectAll?.checked
		? `All ${formatCount(count)} loaded selected`
		: `${formatCount(count)} ${count === 1 ? "message" : "messages"} selected`;

	const overflowItems: PopoverMenuItem[] = [];
	if (onJunk && !isBusy && !isCounting) {
		overflowItems.push({
			key: "junk",
			label: "Junk",
			icon: <ShieldAlert className="size-4" />,
			onSelect: onJunk,
		});
	}
	if (onMarkRead && !isBusy && !isCounting) {
		overflowItems.push({
			key: "mark-read",
			label: "Mark read",
			icon: <MailOpen className="size-4" />,
			onSelect: onMarkRead,
		});
	}

	return (
		<header
			data-selection-bar=""
			className="flex shrink-0 flex-col border-b border-line bg-surface-sunken"
		>
			<div
				data-selection-bar-row="actions"
				className="flex h-pane-header items-center gap-1 px-row-inset"
			>
				{selecting && (
					<Button
						variant="ghost"
						size="touch"
						icon={<ArrowLeft className="size-5" />}
						onClick={onCancel}
						aria-label="Cancel selection"
						className="-ml-2 shrink-0"
					/>
				)}
				{selectAll && (
					<SelectAllToggle
						selectAll={selectAll}
						selecting={selecting}
						className="hidden shrink-0 pr-2 md:flex"
					/>
				)}
				{selecting ? (
					<span
						className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-fg"
						role="status"
						aria-live="polite"
					>
						{statusLabel ?? defaultLabel}
					</span>
				) : (
					<h1 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-fg">
						{title}
					</h1>
				)}
				{selecting && !isCounting && (
					<>
						<Button
							variant="ghost"
							size="touch"
							icon={
								isBusy ? (
									<Loader2 className="size-5 animate-spin" />
								) : (
									<Trash2 className="size-5 text-danger" />
								)
							}
							onClick={isBusy ? undefined : onDelete}
							aria-label="Move selected messages to Trash"
							aria-busy={isBusy || undefined}
							className="shrink-0"
						/>
						{!isBusy && moveSlot}
						{!isBusy && onOrganize && (
							<Button
								variant="ghost"
								size="touch"
								icon={<Sparkles className="size-5" />}
								onClick={onOrganize}
								aria-label="Organize selected messages"
								className="shrink-0"
							/>
						)}
					</>
				)}
				{selecting && (
					<PopoverMenu
						triggerLabel="More actions"
						items={overflowItems}
						className="shrink-0"
					>
						{!isBusy && !isCounting && overflowSlot}
					</PopoverMenu>
				)}
			</div>
			{selecting && selectAll && (
				<div
					data-selection-bar-row="select-all"
					className="px-row-inset pb-2 md:hidden"
				>
					<SelectAllToggle
						selectAll={selectAll}
						selecting={selecting}
						className="w-full"
					/>
				</div>
			)}
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
