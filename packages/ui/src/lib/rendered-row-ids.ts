import { type RefObject, useEffect, useState } from "react";

/** Rows publish their id here, which is what makes them readable in order. */
export const ROW_ID_ATTRIBUTE = "data-message-id";

const ROW_SELECTOR = `[${ROW_ID_ATTRIBUTE}]`;

export const readRowIds = (container: HTMLElement): string[] =>
	Array.from(container.querySelectorAll<HTMLElement>(ROW_SELECTOR))
		.map((row) => row.dataset.messageId)
		.filter((id): id is string => id !== undefined);

export const sameIds = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The ids of the rows currently in the DOM, in document order, kept in step
 * with the rendered list. Sections expand, collapse and cap themselves without
 * the consumer's data changing, so a render pass is not enough of a signal — a
 * MutationObserver is.
 *
 * This is the order a shift-range spans and the set a select-all covers, so
 * both stay inside what the user can actually see.
 */
export const useRenderedRowIds = (
	containerRef: RefObject<HTMLElement | null>,
): string[] => {
	const [rowIds, setRowIds] = useState<string[]>([]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const sync = () => {
			const next = readRowIds(container);
			setRowIds((prev) => (sameIds(prev, next) ? prev : next));
		};

		sync();
		const observer = new MutationObserver(sync);
		observer.observe(container, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [containerRef]);

	return rowIds;
};
