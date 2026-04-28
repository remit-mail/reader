import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useKeyboardNavigation } from "@/hooks/useKeyboardNavigation";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useSelection } from "@/hooks/useSelection";
import { MessageListItem } from "./MessageListItem";
import { MobileSelectionTopBar } from "./MobileSelectionTopBar";
import { SelectionToolbar } from "./SelectionToolbar";

interface MessageListProps {
	mailboxId: string;
	threads: RemitImapThreadMessageResponse[];
	selectedMessageId?: string;
	isLoading: boolean;
	isError?: boolean;
	error?: unknown;
	onRetry?: () => void;
	searchQuery?: string;
	onDeleteMessages?: (messageIds: string[]) => void;
	onMarkAsRead?: (messageIds: string[]) => void;
	isDeleting?: boolean;
	onLoadMore?: () => void;
	hasMore?: boolean;
	isLoadingMore?: boolean;
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
	isError = false,
	error,
	onRetry,
	searchQuery,
	onDeleteMessages,
	onMarkAsRead,
	isDeleting = false,
	onLoadMore,
	hasMore = false,
	isLoadingMore = false,
}: MessageListProps) => {
	const parentRef = useRef<HTMLDivElement>(null);
	const [listRef] = useAutoAnimate<HTMLDivElement>({ duration: 150 });
	const navigate = useNavigate();
	const isDesktop = useIsDesktop();
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

	// Selection state
	const {
		selectedIds,
		selectedCount,
		hasSelection,
		isSelected: isChecked,
		toggle: toggleCheck,
		select,
		clearSelection,
	} = useSelection();

	// Auto-exit multi-select when selection becomes empty
	useEffect(() => {
		if (isMultiSelectMode && selectedCount === 0) {
			setIsMultiSelectMode(false);
		}
	}, [isMultiSelectMode, selectedCount]);

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
			// In multi-select mode, toggle selection instead of navigating
			if (isMultiSelectMode) {
				if (index >= 0 && index < threads.length) {
					const thread = threads[index];
					toggleCheck(thread.messageId);
				}
				return;
			}

			if (index >= 0 && index < threads.length) {
				const thread = threads[index];
				navigate({
					to: "/mail/$mailboxId",
					params: { mailboxId },
					search: { selectedMessageId: thread.messageId },
				});
			}
		},
		[threads, mailboxId, navigate, isMultiSelectMode, toggleCheck],
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

	// Handle mark as read
	const handleMarkAsRead = useCallback(() => {
		if (onMarkAsRead && selectedCount > 0) {
			onMarkAsRead(Array.from(selectedIds));
		}
	}, [onMarkAsRead, selectedCount, selectedIds]);

	// Mobile: Enter multi-select mode on long press
	const handleLongPress = useCallback(
		(messageId: string) => {
			if (!isDesktop) {
				setIsMultiSelectMode(true);
				select(messageId);
			}
		},
		[isDesktop, select],
	);

	// Cancel multi-select mode
	const handleCancelMultiSelect = useCallback(() => {
		setIsMultiSelectMode(false);
		clearSelection();
	}, [clearSelection]);

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

	// Load more when scrolling near the bottom
	useEffect(() => {
		const scrollElement = parentRef.current;
		if (!scrollElement || !hasMore || !onLoadMore) return;

		const handleScroll = () => {
			if (isLoadingMore) return;

			const { scrollTop, scrollHeight, clientHeight } = scrollElement;
			// Trigger when within 200px of the bottom
			const nearBottom = scrollTop + clientHeight >= scrollHeight - 200;

			if (nearBottom) {
				onLoadMore();
			}
		};

		scrollElement.addEventListener("scroll", handleScroll, { passive: true });
		// Also check immediately in case we're already at the bottom
		handleScroll();

		return () => scrollElement.removeEventListener("scroll", handleScroll);
	}, [hasMore, isLoadingMore, onLoadMore]);

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

	if (isError) {
		return (
			<div className="flex h-full items-center justify-center p-4">
				<ErrorState
					title="Couldn't load messages"
					error={error}
					onRetry={onRetry}
				/>
			</div>
		);
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
			{hasSelection && isDesktop && (
				<SelectionToolbar
					selectedCount={selectedCount}
					onDelete={handleDelete}
					onClearSelection={clearSelection}
					onMarkAsRead={onMarkAsRead ? handleMarkAsRead : undefined}
					isDeleting={isDeleting}
				/>
			)}
			{isMultiSelectMode && !isDesktop && (
				<MobileSelectionTopBar
					selectedCount={selectedCount}
					onCancel={handleCancelMultiSelect}
					onDelete={handleDelete}
					onMarkAsRead={onMarkAsRead ? handleMarkAsRead : undefined}
					selectedIds={Array.from(selectedIds)}
				/>
			)}
			{isSearching && searchQuery && (
				<SearchResultsHeader query={searchQuery} count={threads.length} />
			)}
			<div ref={parentRef} className="flex-1 overflow-y-auto" tabIndex={0}>
				<div
					ref={listRef}
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
									isMultiSelectMode={isMultiSelectMode}
									onLongPress={() => handleLongPress(thread.messageId)}
									isDesktop={isDesktop}
								/>
							</div>
						);
					})}
				</div>
				{isLoadingMore && (
					<div className="flex justify-center py-4">
						<div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
					</div>
				)}
			</div>
		</div>
	);
};
