import { Menu } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultKeyboardHints, keyboardHintsFor } from "../lib/keymap.js";
import { LIST_ROW_SELECTOR, useRovingFocus } from "../lib/roving-focus.js";
import { deriveIsMultiSelectMode, modifiersOf } from "../lib/use-selection.js";
import {
	type AppShellProps,
	keyboardWalksRows,
	type MessageListKeyboard,
	type MessageListSelection,
	type TouchSeed,
} from "./app-shell-types.js";
import { type BriefFilterSurface, BriefSections } from "./brief-sections.js";
import { Button } from "./button.js";
import { KeyboardHintBar } from "./keyboard-hint-bar.js";
import {
	MessageListEmpty,
	MessageListError,
	type MessageListFilter,
	MessageListLoading,
} from "./message-list-state.js";
import {
	type BriefRowComponent,
	ComfortableRow,
	CompactRow,
	type RowSelection,
	type RowToggleEvent,
} from "./message-row.js";
import type { SwipePeek } from "./swipeable-row.js";
import { TouchListBody } from "./touch-list.js";

const NO_SELECTION: ReadonlySet<string> = new Set();

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
	briefFilter,
	selectedThreadId,
	density = "comfortable",
	onSelectThread,
	onOpenNav,
	isDesktop,
	initialTouchState,
	selection,
	keyboard,
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
	| "selectedThreadId"
	| "density"
	| "onSelectThread"
> & {
	/**
	 * The active category filter, when the caller has one. Without it the empty
	 * state cannot know it is filtered, and a narrowed list renders the plain
	 * "No messages in this mailbox" — D19's stated failure case. Absent means
	 * unfiltered, so a surface that filters must pass this.
	 */
	listFilter?: MessageListFilter;
	/**
	 * The brief's category scope, account pills and attribute chips, held by the
	 * caller. The cross-account brief is segmented from this panel, and a caller
	 * narrowing the same rows on a second surface hands both the one set it
	 * holds. It comes with `briefFilters`: the list draws these controls and
	 * applies none of them, so chips with no host behind them would tick and
	 * change nothing (#314). Without it the pane renders the plain list, chrome
	 * and all controls left off.
	 */
	briefFilter?: BriefFilterSurface;
	/** Name of the collection, e.g. "Inbox". Passed to the empty state. */
	listScopeLabel?: string;
	/** When set, the list header shows a folders/menu button that opens the nav
	 *  slide-over (list-only widths, where the nav is not a persistent pane). */
	onOpenNav?: () => void;
	/** Container-derived ≥1024; below it the touch triage chrome takes over. */
	isDesktop: boolean;
	initialTouchState?: TouchSeed;
	/**
	 * The list's selection. The pane draws it — the row checkboxes, and the
	 * always-visible ones the touch list shows once a row is ticked — and holds
	 * none of it. Absent means the list does not offer multi-select.
	 */
	selection?: MessageListSelection;
	/**
	 * The keyboard layer driving the list, when the caller mounts one. The pane
	 * binds it to its own element, draws the cursor it moves and offers only the
	 * keys its handlers answer; absent, the footer offers the app's own set and
	 * the rows keep their arrow-key traversal.
	 */
	keyboard?: MessageListKeyboard;
	/**
	 * The pane header. The caller mounts it for every state of the list: a
	 * `SelectionTopBar` names the view while nothing is ticked and carries the
	 * count and the verbs (mark-read, move, delete, cancel) from the first
	 * ticked row. Replaces the pane's own plain title header.
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
	 * Suppress the built-in title header, for a consumer that renders its own
	 * above the pane.
	 */
	hideHeader?: boolean;
}) {
	const Row = density === "compact" ? CompactRow : ComfortableRow;
	const flatListRef = useRef<HTMLDivElement>(null);
	const paneRef = useRef<HTMLElement | null>(null);

	// The layer answers the arrows only if it registered them. Anything else it
	// hands over — a layer with no cursor keys, or no layer at all — leaves the
	// rows their own traversal and their own single tab stop.
	const walksRows = keyboardWalksRows(keyboard);
	useRovingFocus({
		containerRef: flatListRef,
		itemSelector: LIST_ROW_SELECTOR,
		enabled: !walksRows,
	});

	const cursorId = walksRows ? keyboard.focusedId : undefined;
	// One tab stop into the list, as the roving group gives it: the row the
	// cursor is on, or the first row before it has moved.
	const tabStopId = walksRows
		? (cursorId ?? sections[0]?.threads[0]?.id)
		: undefined;
	const rowTabIndex = useCallback(
		(id: string): number | undefined =>
			tabStopId === undefined ? undefined : id === tabStopId ? 0 : -1,
		[tabStopId],
	);

	// Real browser focus follows the cursor, so Tab, Shift+Tab and the focus
	// ring agree with the row the list highlights — and so the keys keep
	// reaching the layer, which listens on the pane rather than the window.
	useEffect(() => {
		if (cursorId === undefined) return;
		const pane = paneRef.current;
		if (!pane) return;
		const row = pane.querySelector<HTMLElement>(
			`${LIST_ROW_SELECTOR}[data-message-id="${cursorId}"]`,
		);
		if (!row || row === pane.ownerDocument.activeElement) return;
		row.focus({ preventScroll: false });
	}, [cursorId]);

	// A layer bound to this pane hears nothing until focus is inside it. Taking
	// focus on mount is what keeps j working without a click first — and only
	// from a document where nothing else has claimed it, so a page of stories
	// does not fight over the caret.
	useEffect(() => {
		if (!walksRows) return;
		const pane = paneRef.current;
		if (!pane) return;
		const active = pane.ownerDocument.activeElement;
		if (active !== null && active !== pane.ownerDocument.body) return;
		pane.focus({ preventScroll: true });
	}, [walksRows]);

	const touchTriage = !isDesktop && !briefFilters && listState === "ready";
	const [refreshing, setRefreshing] = useState(false);
	const initialPeek: SwipePeek | undefined =
		initialTouchState === "peek-trailing"
			? "trailing"
			: initialTouchState === "peek-leading"
				? "leading"
				: undefined;

	const refresh = () => {
		setRefreshing(true);
		setTimeout(() => setRefreshing(false), 1400);
	};

	const selectedIds = selection?.selectedIds ?? NO_SELECTION;
	const toggleSelected = selection?.onToggle;
	const onRowSelect = selection?.onRowSelect;
	// Multi-select is the touch affordance, and it is a function of the count
	// rather than a flag, so ticking the last row off leaves it on its own.
	const selectionMode = deriveIsMultiSelectMode(selectedIds.size, isDesktop);

	// The checkbox takes the avatar's place on hover, and stays put once the row
	// is ticked.
	const rowSelection = useCallback(
		(id: string): RowSelection | undefined => {
			if (!toggleSelected) return undefined;
			return {
				checked: selectedIds.has(id),
				onToggle: (event: RowToggleEvent) => {
					event.preventDefault();
					event.stopPropagation();
					toggleSelected(id);
				},
			};
		},
		[selectedIds, toggleSelected],
	);

	// Shift ranges and cmd/ctrl ticks, so a modified click never opens the row it
	// was aimed at. Shift-click otherwise drags a native text selection across
	// the rows it spans — the row highlight is the selection the user asked for.
	const takeRowSelect = useCallback(
		(id: string, event: MouseEvent): boolean => {
			if (!onRowSelect?.(id, modifiersOf(event))) return false;
			event.preventDefault();
			if (event.shiftKey) window.getSelection()?.removeAllRanges();
			return true;
		},
		[onRowSelect],
	);

	// The brief drives rows through a `BriefRowComponent`, whose props carry no
	// selection — a consumer's own row (the web client's) wires its checkbox
	// itself. Binding it here keeps the kit's rows selectable there too.
	const BriefRow: BriefRowComponent = useCallback(
		({ thread, active, onClick }) => (
			<Row
				thread={thread}
				active={active}
				focused={thread.id === cursorId}
				tabIndex={rowTabIndex(thread.id)}
				selection={rowSelection(thread.id)}
				onClick={(event) => {
					if (takeRowSelect(thread.id, event)) return;
					onClick?.();
				}}
			/>
		),
		[Row, rowSelection, takeRowSelect, cursorId, rowTabIndex],
	);

	return (
		<section
			ref={(element) => {
				paneRef.current = element;
				keyboard?.ref(element);
			}}
			tabIndex={walksRows ? -1 : undefined}
			className="relative flex h-full w-full flex-col bg-surface outline-none"
		>
			{selectionBar ??
				(hideHeader ? null : (
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
			) : briefFilters && briefFilter ? (
				<BriefSections
					{...briefFilter}
					sections={sections}
					selectedThreadId={selectedThreadId}
					Row={BriefRow}
					keyboard={keyboard}
					onSelectThread={onSelectThread}
				/>
			) : listBody != null ? (
				/* Consumer-provided body wins on every width — it owns the rows
				   (real <a href> anchors, virtualization, infinite scroll) and its
				   own swipe-triage. The built-in TouchListBody below is only the
				   mock fallback for callers that don't supply a body. */
				listBody
			) : touchTriage ? (
				<TouchListBody
					sections={sections}
					selectedThreadId={selectedThreadId}
					selectionMode={selectionMode}
					checkedIds={selectedIds}
					initialPeek={initialPeek}
					onToggleCheck={(id) => toggleSelected?.(id)}
					onEnterSelection={(id) => toggleSelected?.(id)}
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
										focused={thread.id === cursorId}
										tabIndex={rowTabIndex(thread.id)}
										selection={rowSelection(thread.id)}
										onClick={(event) => {
											if (takeRowSelect(thread.id, event)) return;
											onSelectThread?.(thread.id);
										}}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{isDesktop && (
				<KeyboardHintBar
					hints={
						keyboard
							? keyboardHintsFor(keyboard.handlers)
							: defaultKeyboardHints
					}
				/>
			)}
			{paneOverlay}
		</section>
	);
}
