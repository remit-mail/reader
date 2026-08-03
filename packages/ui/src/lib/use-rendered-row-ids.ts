/**
 * The ids of the list rows currently in the DOM, in document order.
 *
 * A list's rows are not the rows its consumer handed down. The brief's sections
 * cap themselves at ten behind "Show N more", apply their own attribute chips
 * and collapse from their headers, none of which the consumer's data describes.
 * A cursor walking that data steps onto rows nobody can see, and a count taken
 * from it names messages the verbs then act on.
 *
 * Those changes are re-renders of a component below the consumer, so a render
 * pass of the consumer's own is not a signal — a MutationObserver is.
 */
import { useEffect, useState } from "react";

/** Marks a rendered row with the id the cursor finds it by. */
export const ROW_ID_SELECTOR = "[data-message-id]";

const readRowIds = (container: HTMLElement): string[] =>
	Array.from(container.querySelectorAll<HTMLElement>(ROW_ID_SELECTOR))
		.map((row) => row.dataset.messageId)
		.filter((id): id is string => id !== undefined);

const sameIds = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The rendered row ids inside `container`, or null while there is no container
 * to read — which a caller holding ids of its own answers with those, since an
 * unmounted list has not yet said anything about what it shows. An empty array
 * is an answer: the list is mounted and rendering no rows.
 */
export function useRenderedRowIds(
	container: HTMLElement | null,
): string[] | null {
	const [rowIds, setRowIds] = useState<string[] | null>(null);

	useEffect(() => {
		if (container === null) {
			setRowIds(null);
			return;
		}

		const sync = () => {
			const next = readRowIds(container);
			setRowIds((prev) => (prev !== null && sameIds(prev, next) ? prev : next));
		};

		sync();
		const observer = new MutationObserver(sync);
		observer.observe(container, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [container]);

	return rowIds;
}
