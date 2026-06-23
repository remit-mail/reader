import { Menu } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import type { AppShellProps, TouchSeed } from "./app-shell-types.js";
import { BriefSections } from "./brief-sections.js";
import { Button } from "./button.js";
import { KeyboardHintBar } from "./keyboard-hint-bar.js";
import {
	MessageListEmpty,
	MessageListError,
	MessageListLoading,
} from "./message-list-state.js";
import { ComfortableRow, CompactRow } from "./message-row.js";
import { SelectionTopBar } from "./selection-top-bar.js";
import type { SwipePeek } from "./swipeable-row.js";
import { TouchListBody } from "./touch-list.js";

/* ------------------------------------------------------------------ */
/* Pane 2: message list (sectioned, dense, density toggle)            */
/* ------------------------------------------------------------------ */

export function MessageListPane({
	listTitle,
	listMeta,
	chips,
	mutedNote,
	sections,
	briefFilters,
	flatList,
	listState = "ready",
	searchQuery,
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
}: Pick<
	AppShellProps,
	| "listTitle"
	| "listMeta"
	| "chips"
	| "mutedNote"
	| "sections"
	| "briefFilters"
	| "flatList"
	| "listState"
	| "searchQuery"
	| "onRetry"
	| "onReportError"
	| "briefCategory"
	| "selectedThreadId"
	| "density"
	| "onSelectThread"
	| "onSelectBriefCategory"
> & {
	/** When set, the list header shows a folders/menu button that opens the nav
	 *  slide-over (list-only widths, where the nav is not a persistent pane). */
	onOpenNav?: () => void;
	/** Container-derived ≥1024; below it the touch triage chrome takes over. */
	isDesktop: boolean;
	initialTouchState?: TouchSeed;
}) {
	const Row = density === "compact" ? CompactRow : ComfortableRow;
	const showChipBar = !briefFilters && !flatList && chips && chips.length > 0;

	const touchTriage = !isDesktop && !briefFilters && listState === "ready";
	const seededRows = sections.flatMap((section) => section.threads);
	const [selectionMode, setSelectionMode] = useState(
		initialTouchState === "selection",
	);
	const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(() =>
		initialTouchState === "selection"
			? new Set(seededRows.slice(0, 2).map((t) => t.id))
			: new Set(),
	);
	const [refreshing, setRefreshing] = useState(false);
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
	const refresh = () => {
		setRefreshing(true);
		setTimeout(() => setRefreshing(false), 1400);
	};

	const inSelection = touchTriage && selectionMode && checkedIds.size > 0;

	return (
		<section className="flex h-full w-full flex-col bg-surface">
			{inSelection ? (
				<SelectionTopBar
					count={checkedIds.size}
					onCancel={cancelSelection}
					onMarkRead={cancelSelection}
					onDelete={cancelSelection}
				/>
			) : (
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
						<span className="shrink-0 text-2xs text-fg-subtle">{listMeta}</span>
					)}
				</header>
			)}

			{/* secondary row only for non-brief, non-flat lists; the brief's account
			    chips live inside BriefSections (the filter drawer on mobile), and the
			    plain flat mailbox carries no chip bar */}
			{showChipBar && (
				<div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-row-inset py-1">
					{chips.map((chip) => (
						<button
							key={chip.id}
							type="button"
							className={cn(
								"flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
								chip.active
									? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
									: "border-line text-fg-muted hover:border-line-strong",
							)}
						>
							{chip.label}
							{chip.count != null && (
								<span className="tabular-nums opacity-70">{chip.count}</span>
							)}
						</button>
					))}
					{mutedNote && (
						<span className="ml-auto shrink-0 text-2xs text-fg-subtle">
							{mutedNote}
						</span>
					)}
				</div>
			)}

			{/* List body. Non-ready states replace the rows entirely (the live
			    MessageList does the same): skeleton on cold load, empty on a clean
			    mailbox / search, fail-hard error with a way back + report. */}
			{listState === "loading" ? (
				<div className="flex-1 overflow-y-auto">
					<MessageListLoading />
				</div>
			) : listState === "empty" ? (
				<MessageListEmpty searchQuery={searchQuery} />
			) : listState === "error" ? (
				<MessageListError onRetry={onRetry} onReport={onReportError} />
			) : briefFilters ? (
				<BriefSections
					sections={sections}
					briefCategory={briefCategory}
					selectedThreadId={selectedThreadId}
					accountChips={chips}
					mutedNote={mutedNote}
					Row={Row}
					isDesktop={isDesktop}
					onSelectThread={onSelectThread}
					onSelectBriefCategory={onSelectBriefCategory}
				/>
			) : touchTriage ? (
				<TouchListBody
					sections={sections}
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
				<div className="flex-1 overflow-y-auto">
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
										onClick={() => onSelectThread?.(thread.id)}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{isDesktop && <KeyboardHintBar />}
		</section>
	);
}
