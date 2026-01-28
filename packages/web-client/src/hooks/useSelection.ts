import { useCallback, useState } from "react";

interface UseSelectionOptions<T> {
	/** Function to extract ID from an item */
	getId: (item: T) => string;
}

interface UseSelectionReturn {
	/** Set of currently selected item IDs */
	selectedIds: Set<string>;
	/** Number of selected items */
	selectedCount: number;
	/** Whether any items are selected */
	hasSelection: boolean;
	/** Check if a specific item is selected */
	isSelected: (id: string) => boolean;
	/** Toggle selection for a single item */
	toggle: (id: string) => void;
	/** Select a single item (adds to selection) */
	select: (id: string) => void;
	/** Deselect a single item */
	deselect: (id: string) => void;
	/** Select all items */
	selectAll: (ids: string[]) => void;
	/** Clear all selections */
	clearSelection: () => void;
	/** Toggle selection for all items */
	toggleAll: (ids: string[]) => void;
}

/**
 * Hook for managing selection state in lists.
 * Supports single and multi-select operations.
 */
export const useSelection = <T>(
	_options?: UseSelectionOptions<T>,
): UseSelectionReturn => {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const isSelected = useCallback(
		(id: string) => selectedIds.has(id),
		[selectedIds],
	);

	const toggle = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	const select = useCallback((id: string) => {
		setSelectedIds((prev) => {
			if (prev.has(id)) return prev;
			const next = new Set(prev);
			next.add(id);
			return next;
		});
	}, []);

	const deselect = useCallback((id: string) => {
		setSelectedIds((prev) => {
			if (!prev.has(id)) return prev;
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
	}, []);

	const selectAll = useCallback((ids: string[]) => {
		setSelectedIds(new Set(ids));
	}, []);

	const clearSelection = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const toggleAll = useCallback((ids: string[]) => {
		setSelectedIds((prev) => {
			const allSelected = ids.every((id) => prev.has(id));
			return allSelected ? new Set() : new Set(ids);
		});
	}, []);

	return {
		selectedIds,
		selectedCount: selectedIds.size,
		hasSelection: selectedIds.size > 0,
		isSelected,
		toggle,
		select,
		deselect,
		selectAll,
		clearSelection,
		toggleAll,
	};
};
