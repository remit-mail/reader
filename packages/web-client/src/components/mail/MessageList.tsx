import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useSelection } from "@/hooks/useSelection";
import { MessageListItem } from "./MessageListItem";
import { SelectionToolbar } from "./SelectionToolbar";

interface MessageListProps {
	mailboxId: string;
	threads: RemitImapThreadMessageResponse[];
	selectedMessageId?: string;
	isLoading: boolean;
	searchQuery?: string;
	onDeleteMessages?: (messageIds: string[]) => void;
	isDeleting?: boolean;
}

const ESTIMATED_ITEM_HEIGHT = 72;
const OVERSCAN_COUNT = 5;

const LoadingSkeleton = () => (
	<div className="space-y-0">
		{Array.from({ length: 8 }).map((_, i) => (
			<div key={i} className="px-3 py-2 border-b border-border animate-pulse">
				<div className="flex items-center justify-between mb-2">
					<div className="h-4 bg-muted rounded w-32" />
					<div className="h-3 bg-muted rounded w-16" />
				</div>
				<div className="h-4 bg-muted rounded w-48 mb-2" />
				<div className="h-3 bg-muted rounded w-full" />
			</div>
		))}
	</div>
);

const SearchResultsHeader = ({
	query,
	count,
}: {
	query: string;
	count: number;
}) => (
	<div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
		<Search className="size-4 text-muted-foreground" />
		<span className="text-sm text-muted-foreground">
			{count} {count === 1 ? "result" : "results"} for "{query}"
		</span>
	</div>
);

export const MessageList = ({
	mailboxId,
	threads,
	selectedMessageId,
	isLoading,
	searchQuery,
	onDeleteMessages,
	isDeleting = false,
}: MessageListProps) => {
	const parentRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();

	// Selection state
	const {
		selectedIds,
		selectedCount,
		hasSelection,
		isSelected: isChecked,
		toggle: toggleCheck,
		clearSelection,
	} = useSelection();

	const virtualizer = useVirtualizer({
		count: threads.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => ESTIMATED_ITEM_HEIGHT,
		overscan: OVERSCAN_COUNT,
	});

	// Find current index
	const currentIndex = selectedMessageId
		? threads.findIndex((t) => t.messageId === selectedMessageId)
		: -1;

	// Navigation handlers
	const selectByIndex = useCallback(
		(index: number) => {
			if (index >= 0 && index < threads.length) {
				const thread = threads[index];
				navigate({
					to: "/mail/$mailboxId",
					params: { mailboxId },
					search: { selectedMessageId: thread.messageId },
				});
			}
		},
		[threads, mailboxId, navigate],
	);

	const selectNext = useCallback(() => {
		if (threads.length === 0) return;
		const nextIndex =
			currentIndex < 0 ? 0 : Math.min(currentIndex + 1, threads.length - 1);
		selectByIndex(nextIndex);
	}, [threads.length, currentIndex, selectByIndex]);

	const selectPrevious = useCallback(() => {
		if (threads.length === 0) return;
		const prevIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
		selectByIndex(prevIndex);
	}, [threads.length, currentIndex, selectByIndex]);

	// Toggle selection on focused item with x key
	const toggleFocusedSelection = useCallback(() => {
		if (selectedMessageId) {
			toggleCheck(selectedMessageId);
		}
	}, [selectedMessageId, toggleCheck]);

	// Handle delete
	const handleDelete = useCallback(() => {
		if (onDeleteMessages && selectedCount > 0) {
			onDeleteMessages(Array.from(selectedIds));
		}
	}, [onDeleteMessages, selectedCount, selectedIds]);

	// Scroll selected item into view when it changes
	useEffect(() => {
		if (currentIndex >= 0) {
			virtualizer.scrollToIndex(currentIndex, { align: "auto" });
		}
	}, [currentIndex, virtualizer]);

	// Clear selection when threads change (e.g., after delete)
	useEffect(() => {
		const threadIds = new Set(threads.map((t) => t.messageId));
		const hasOrphanedSelection = Array.from(selectedIds).some(
			(id) => !threadIds.has(id),
		);
		if (hasOrphanedSelection) {
			clearSelection();
		}
	}, [threads, selectedIds, clearSelection]);

	// Keyboard navigation
	useKeyboardNavigation({
		enabled: !isLoading && threads.length > 0,
		bindings: [
			{ key: "j", handler: selectNext, preventDefault: true },
			{ key: "ArrowDown", handler: selectNext, preventDefault: true },
			{ key: "k", handler: selectPrevious, preventDefault: true },
			{ key: "ArrowUp", handler: selectPrevious, preventDefault: true },
			{ key: "x", handler: toggleFocusedSelection, preventDefault: true },
		],
	});

	if (isLoading) {
		return <LoadingSkeleton />;
	}

	const isSearching = !!searchQuery?.trim();

	if (threads.length === 0) {
		return (
			<div className="flex flex-col h-full">
				{isSearching && searchQuery && (
					<SearchResultsHeader query={searchQuery} count={0} />
				)}
				<div className="flex flex-1 items-center justify-center">
					<EmptyState
						message={
							isSearching
								? "No messages match your search"
								: "No messages in this mailbox"
						}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			{hasSelection && (
				<SelectionToolbar
					selectedCount={selectedCount}
					onDelete={handleDelete}
					onClearSelection={clearSelection}
					isDeleting={isDeleting}
				/>
			)}
			{isSearching && searchQuery && (
				<SearchResultsHeader query={searchQuery} count={threads.length} />
			)}
			<div ref={parentRef} className="flex-1 overflow-y-auto" tabIndex={0}>
				<div
					className="relative w-full"
					style={{ height: `${virtualizer.getTotalSize()}px` }}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const thread = threads[virtualRow.index];
						return (
							<div
								key={virtualRow.key}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className="absolute left-0 top-0 w-full"
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<MessageListItem
									thread={thread}
									mailboxId={mailboxId}
									isSelected={selectedMessageId === thread.messageId}
									isChecked={isChecked(thread.messageId)}
									onToggleCheck={toggleCheck}
								/>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};
