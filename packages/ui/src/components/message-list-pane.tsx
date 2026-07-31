import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { LIST_ROW_SELECTOR, useRovingFocus } from "../lib/roving-focus.js";
import type { AppShellProps, TouchSeed } from "./app-shell-types.js";
import { BriefSections } from "./brief-sections.js";
import { Button } from "./button.js";
import { KeyboardHintBar } from "./keyboard-hint-bar.js";
import {
	MessageListEmpty,
	MessageListError,
	type MessageListFilter,
	MessageListLoading,
} from "./message-list-state.js";
import {
	ComfortableRow,
	CompactRow,
	type RowToggleEvent,
} from "./message-row.js";
import { SelectionTopBar } from "./selection-top-bar.js";
import type { SwipePeek } from "./swipeable-row.js";
import { TouchListBody } from "./touch-list.js";

/* ------------------------------------------------------------------ */
/* Pane 2: message list (sectioned, dense, density toggle)            */
/* ------------------------------------------------------------------ */

export function MessageListPane({
	listTitle,
	listMeta,
	sections,
	briefFilters,
	flatList,
	listState = "ready",
	searchQuery,
	listFilter,
	listScopeLabel,
	errorMessage,
	onRetry,
	onReportError,
	briefCategory,
	selectedThreadId,
	density = "comfortable",
	onSelectThread,
	onSelectBriefCategory,
	onOpenNav,
	isDesktop,
	initialTouchState,
	selectionBar,
	paneOverlay,
	listBody,
	hideHeader = false,
}: Pick<
	AppShellProps,
	| "listTitle"
	| "listMeta"
	| "sections"
	| "briefFilters"
	| "flatList"
	| "listState"
	| "searchQuery"
	| "errorMessage"
	| "onRetry"
	| "onReportError"
	| "briefCategory"
	| "selectedThreadId"
	| "density"
	| "onSelectThread"
	| "onSelectBriefCategory"
> & {
	/**
	 * The active category filter, when the caller has one. Without it the empty
	 * state cannot know it is filtered, and a narrowed list renders the plain
	 * "No messages in this mailbox" — D19's stated failure case. Absent means
	 * unfiltered, so a surface that filters must pass this.
	 */
	listFilter?: MessageListFilter;
	/** Name of the collection, e.g. "Inbox". Passed to the empty state. */
	listScopeLabel?: string;
	/** When set, the list header shows a folders/menu button that opens the nav
	 *  slide-over (list-only widths, where the nav is not a persistent pane). */
	onOpenNav?: () => void;
	/** Container-derived ≥1024; below it the touch triage chrome takes over. */
	isDesktop: boolean;
	initialTouchState?: TouchSeed;
	/**
	 * Replaces the pane header when a selection is active. The caller controls
	 * the selection state and toolbar actions (mark-read, move, delete, cancel).
	 * When omitted the pane's built-in touch-triage selection bar is used.
	 */
	selectionBar?: ReactNode;
	/**
	 * An overlay covering the pane, above the rows — the guided organize flow.
	 * The pane is the positioned ancestor it measures against, and it is
	 * rendered last so it sits over everything the pane draws.
	 */
	paneOverlay?: ReactNode;
	/**
	 * Overrides the row-rendering section of the non-brief list — the whole
	 * scrollable body including virtualization, swipe-triage and any load-more
	 * indicator. Wins on every width (desktop and touch): the consumer owns the
	 * rows, so they stay real `<a href>` anchors and keep their own gestures
	 * instead of the kit substituting the mock `TouchListBody`. Brief paths are
	 * unaffected. When set, `sections` / `selectedThreadId` / `onSelectThread`
	 * are still used by the pane chrome; the rows themselves come from this slot.
	 */
	listBody?: ReactNode;
	/**
	 * Suppress the built-in title header. The consumer owns the header (e.g. the
	 * shared `MailHeader` rendered above the pane). The selection bar still
	 * replaces the (now absent) header while a selection is active.
	 */
	hideHeader?: boolean;
}) {
	const Row = density === "compact" ? CompactRow : ComfortableRow;
	const flatListRef = useRef<HTMLDivElement>(null);
	useRovingFocus({
		containerRef: flatListRef,
		itemSelector: LIST_ROW_SELECTOR,
	});

	const touchTriage = !isDesktop && !briefFilters && listState === "ready";
	const seededRows = sections.flatMap((section) => section.threads);
	const [selectionMode, setSelectionMode] = useState(
		initialTouchState === "selection",
	);
	// The seed is a touch-triage state; desktop starts unselected and gets there
	// through the row checkboxes.
	const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(() =>
		initialTouchState === "selection" && !isDesktop
			? new Set(seededRows.slice(0, 2).map((t) => t.id))
			: new Set(),
	);
	// What the fallback bar's verbs have done to the mock rows. A demo bar whose
	// Trash only closes the bar is a Trash that deletes nothing, which is the one
	// thing a selection bar must never be — so these verbs act on the rows the
	// mock owns, the same way `refresh` below fakes a refresh visibly.
	const [trashedIds, setTrashedIds] = useState<ReadonlySet<string>>(new Set());
	const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());
	const [refreshing, setRefreshing] = useState(false);
	const touchSections = useMemo(
		() =>
			trashedIds.size === 0 && readIds.size === 0
				? sections
				: sections.map((section) => ({
						...section,
						threads: section.threads
							.filter((thread) => !trashedIds.has(thread.id))
							.map((thread) =>
								readIds.has(thread.id) ? { ...thread, isRead: true } : thread,
							),
					})),
		[sections, trashedIds, readIds],
	);
	const initialPeek: SwipePeek | undefined =
		initialTouchState === "peek-trailing"
			? "trailing"
			: initialTouchState === "peek-leading"
				? "leading"
				: undefined;

	const toggleCheck = (id: string) => {
		setCheckedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			if (next.size === 0) setSelectionMode(false);
			return next;
		});
	};
	const enterSelection = (id: string) => {
		setSelectionMode(true);
		setCheckedIds(new Set([id]));
	};
	const cancelSelection = () => {
		setSelectionMode(false);
		setCheckedIds(new Set());
	};
	const trashChecked = () => {
		setTrashedIds((prev) => new Set([...prev, ...checkedIds]));
		cancelSelection();
	};
	const markCheckedRead = () => {
		setReadIds((prev) => new Set([...prev, ...checkedIds]));
		cancelSelection();
	};
	const refresh = () => {
		setRefreshing(true);
		setTimeout(() => setRefreshing(false), 1400);
	};

	// Desktop rows carry the checkbox the app's own rows have: it takes the
	// avatar's place on hover, and checking one puts the pane in selection.
	const desktopSelectable = isDesktop && !selectionBar && listState === "ready";
	const rowSelection = (id: string) =>
		desktopSelectable
			? {
					checked: checkedIds.has(id),
					onToggle: (event: RowToggleEvent) => {
						event.preventDefault();
						event.stopPropagation();
						toggleCheck(id);
					},
				}
			: undefined;

	const selectableIds = seededRows.map((thread) => thread.id);
	const allChecked =
		selectableIds.length > 0 && selectableIds.every((id) => checkedIds.has(id));
	const selectAll = {
		checked: allChecked,
		indeterminate: checkedIds.size > 0 && !allChecked,
		onChange: () =>
			setCheckedIds(allChecked ? new Set() : new Set(selectableIds)),
	};

	// When the caller supplies a selectionBar slot, it owns selection state.
	// Fall back to the built-in bar only when no external bar is given.
	const inBuiltinSelection =
		!selectionBar &&
		checkedIds.size > 0 &&
		(desktopSelectable || (touchTriage && selectionMode));

	return (
		<section className="relative flex h-full w-full flex-col bg-surface">
			{selectionBar ??
				(inBuiltinSelection ? (
					<SelectionTopBar
						title={listTitle}
						count={checkedIds.size}
						selectAll={desktopSelectable ? selectAll : undefined}
						onCancel={cancelSelection}
						onMarkRead={markCheckedRead}
						onDelete={trashChecked}
					/>
				) : hideHeader ? null : (
					<header className="flex h-pane-header shrink-0 items-center gap-2 border-b border-line px-row-inset">
						{onOpenNav && (
							<Button
								variant="ghost"
								size="sm"
								icon={<Menu className="size-4" />}
								onClick={onOpenNav}
								aria-label="Open folders"
								className="-ml-1 shrink-0"
							/>
						)}
						<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
							{listTitle}
						</h1>
						{listMeta && (
							<span className="shrink-0 text-2xs text-fg-subtle">
								{listMeta}
							</span>
						)}
					</header>
				))}

			{/* List body. Non-ready states replace the rows entirely (the live
			    MessageList does the same): skeleton on cold load, empty on a clean
			    mailbox / search, fail-hard error with a way back + report. */}
			{listState === "loading" ? (
				<div className="flex-1 overflow-y-auto">
					<MessageListLoading />
				</div>
			) : listState === "empty" ? (
				<MessageListEmpty
					filter={listFilter}
					scopeLabel={listScopeLabel}
					searchQuery={searchQuery}
				/>
			) : listState === "error" ? (
				<MessageListError
					message={errorMessage}
					onRetry={onRetry}
					onReport={onReportError}
				/>
			) : briefFilters ? (
				<BriefSections
					sections={sections}
					briefCategory={briefCategory}
					selectedThreadId={selectedThreadId}
					Row={Row}
					onSelectThread={onSelectThread}
					onSelectBriefCategory={onSelectBriefCategory}
				/>
			) : listBody != null ? (
				/* Consumer-provided body wins on every width — it owns the rows
				   (real <a href> anchors, virtualization, infinite scroll) and its
				   own swipe-triage. The built-in TouchListBody below is only the
				   mock fallback for callers that don't supply a body. */
				listBody
			) : touchTriage ? (
				<TouchListBody
					sections={touchSections}
					selectedThreadId={selectedThreadId}
					selectionMode={selectionMode}
					checkedIds={checkedIds}
					initialPeek={initialPeek}
					onToggleCheck={toggleCheck}
					onEnterSelection={enterSelection}
					onOpenThread={(id) => onSelectThread?.(id)}
					onRefresh={refresh}
					refreshing={refreshing}
				/>
			) : (
				<div ref={flatListRef} className="flex-1 overflow-y-auto">
					{sections.map((section) => (
						<div key={section.id}>
							{/* The plain flat mailbox suppresses section labels — it is one
							    continuous list, like the live $mailboxId MessageList. */}
							{!flatList && section.label && (
								<div className="sticky top-0 flex h-section-row items-center justify-between border-b border-line bg-surface-sunken px-row-inset">
									<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
										{section.label}
									</span>
									<span className="text-2xs text-fg-subtle tabular-nums">
										{section.threads.length}
									</span>
								</div>
							)}
							<div className="divide-y divide-line">
								{section.threads.map((thread) => (
									<Row
										key={thread.id}
										thread={thread}
										active={thread.id === selectedThreadId}
										selection={rowSelection(thread.id)}
										onClick={() => onSelectThread?.(thread.id)}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{isDesktop && <KeyboardHintBar />}
			{paneOverlay}
		</section>
	);
}
