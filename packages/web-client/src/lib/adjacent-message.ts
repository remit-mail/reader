/**
 * Resolves the message id adjacent to `currentId` in `orderedIds`.
 *
 * The list is in display order (newest first). "next" walks down the list
 * (older), "previous" walks up (newer) — matching the j/k keyboard navigation
 * and the visual top-to-bottom order. Returns `null` at the ends of the list
 * (no wrap) and when the current id is not present.
 */
export const adjacentMessageId = (
	orderedIds: string[],
	currentId: string | undefined,
	direction: "next" | "previous",
): string | null => {
	if (!currentId) return null;
	const index = orderedIds.indexOf(currentId);
	if (index === -1) return null;
	const target = direction === "next" ? index + 1 : index - 1;
	if (target < 0 || target >= orderedIds.length) return null;
	return orderedIds[target];
};
