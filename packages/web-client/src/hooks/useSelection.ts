import { useCallback, useState } from "react";

/**
 * Mouse/keyboard modifier flags read off a row click, used to drive desktop
 * multi-select semantics (shift = range, cmd/ctrl = toggle, plain = open).
 */
export interface SelectionModifiers {
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
}

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
	/** Toggle selection for a single item (updates the range anchor) */
	toggle: (id: string) => void;
	/** Select a single item (adds to selection, updates the range anchor) */
	select: (id: string) => void;
	/** Deselect a single item */
	deselect: (id: string) => void;
	/** Select all items */
	selectAll: (ids: string[]) => void;
	/** Clear all selections (also clears the range anchor) */
	clearSelection: () => void;
	/** Toggle selection for all items */
	toggleAll: (ids: string[]) => void;
	/**
	 * Add the contiguous range of ids from the current anchor to `targetId`
	 * (inclusive) to the selection, using `orderedIds` for display order. If
	 * no anchor exists, selects only `targetId` and makes it the anchor.
	 */
	selectRange: (orderedIds: string[], targetId: string) => void;
	/**
	 * Set the range anchor without changing the selection set. Used by a plain
	 * click that navigates but should seed the anchor for a later shift-click.
	 */
	setAnchor: (id: string) => void;
	/**
	 * The id of the row that anchors shift-range selection. `undefined` when
	 * nothing has been selected yet.
	 */
	anchorId: string | undefined;
	/**
	 * Narrows the selection to whatever in it is still present in `currentIds`
	 * — drops ids that left, keeps every survivor. Never adds anything, and
	 * never clears the selection just because one id is gone (#111).
	 */
	intersectWith: (currentIds: readonly string[]) => void;
}

/**
 * Compute the inclusive slice of ids spanning from `anchorId` to `targetId`
 * in `orderedIds`. Pure so it can be unit-tested without a DOM.
 *
 * - Direction-agnostic: works whether the target sits above or below the anchor.
 * - Missing anchor (or anchor not in the list): returns just `[targetId]`.
 * - Target not in the list: returns `[]` (nothing to select).
 */
export const computeRange = (
	orderedIds: string[],
	anchorId: string | undefined,
	targetId: string,
): string[] => {
	const targetIndex = orderedIds.indexOf(targetId);
	if (targetIndex === -1) return [];

	const anchorIndex =
		anchorId === undefined ? -1 : orderedIds.indexOf(anchorId);
	if (anchorIndex === -1) return [targetId];

	const start = Math.min(anchorIndex, targetIndex);
	const end = Math.max(anchorIndex, targetIndex);
	return orderedIds.slice(start, end + 1);
};

/**
 * The ids from `selectedIds` that are still present in `currentIds` — the
 * survivor set after a list refresh. Only ever narrows: an id absent from
 * `selectedIds` is never added just because it's in `currentIds`. Pure so the
 * "drop what left, keep the rest" behavior (K-9's `selected.intersect
 * (uniqueIds)`, cited by #92 D2) can be unit-tested without a DOM.
 */
export const intersectSelectedIds = (
	selectedIds: ReadonlySet<string>,
	currentIds: readonly string[],
): Set<string> => {
	const present = new Set(currentIds);
	const next = new Set<string>();
	for (const id of selectedIds) {
		if (present.has(id)) next.add(id);
	}
	return next;
};

/**
 * Compute the id one step from `focusId` in `orderedIds`, clamped at the ends.
 * Pure so the shift-arrow range-extend math can be unit-tested without a DOM.
 *
 * - `direction` is -1 for up (previous) or +1 for down (next).
 * - Missing focus (or focus not in the list): returns the first id for down,
 *   the last id for up, or `undefined` when the list is empty.
 * - At a boundary: returns the same `focusId` (no wrap).
 */
export const nextFocusId = (
	orderedIds: string[],
	focusId: string | undefined,
	direction: -1 | 1,
): string | undefined => {
	if (orderedIds.length === 0) return undefined;

	const currentIndex = focusId === undefined ? -1 : orderedIds.indexOf(focusId);
	if (currentIndex === -1) {
		return direction > 0 ? orderedIds[0] : orderedIds[orderedIds.length - 1];
	}

	const nextIndex = Math.min(
		Math.max(currentIndex + direction, 0),
		orderedIds.length - 1,
	);
	return orderedIds[nextIndex];
};

/**
 * Hook for managing selection state in lists.
 * Supports single and multi-select operations.
 */
export const useSelection = <T>(
	_options?: UseSelectionOptions<T>,
): UseSelectionReturn => {
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [anchorId, setAnchorId] = useState<string | undefined>(undefined);

	const isSelected = useCallback(
		(id: string) => selectedIds.has(id),
		[selectedIds],
	);

	const toggle = useCallback((id: string) => {
		setAnchorId(id);
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
		setAnchorId(id);
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
		setAnchorId(undefined);
		setSelectedIds(new Set());
	}, []);

	const toggleAll = useCallback((ids: string[]) => {
		setSelectedIds((prev) => {
			const allSelected = ids.every((id) => prev.has(id));
			return allSelected ? new Set() : new Set(ids);
		});
	}, []);

	const setAnchor = useCallback((id: string) => {
		setAnchorId(id);
	}, []);

	// Bails out to the same `prev` reference when nothing was dropped, so a
	// caller can run this on every list refresh (e.g. an effect keyed on
	// `threads`) without forcing a render each time.
	const intersectWith = useCallback((currentIds: readonly string[]) => {
		setSelectedIds((prev) => {
			if (prev.size === 0) return prev;
			const next = intersectSelectedIds(prev, currentIds);
			return next.size === prev.size ? prev : next;
		});
	}, []);

	const selectRange = useCallback(
		(orderedIds: string[], targetId: string) => {
			setSelectedIds((prev) => {
				const range = computeRange(orderedIds, anchorId, targetId);
				if (range.length === 0) return prev;
				const next = new Set(prev);
				for (const id of range) {
					next.add(id);
				}
				return next;
			});
			// Keep the original anchor so subsequent shift-clicks extend from the
			// same origin (Apple Mail / Gmail behavior). Only seed the anchor when
			// none exists yet.
			setAnchorId((prev) => prev ?? targetId);
		},
		[anchorId],
	);

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
		selectRange,
		setAnchor,
		anchorId,
		intersectWith,
	};
};
