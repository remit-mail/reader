/**
 * The rows a message list is actually showing, read from the DOM.
 *
 * A list narrows itself in ways its data never records: a section caps itself
 * behind "Show N more", collapses from its own header, or falls out of a
 * category scope. The ids a consumer hands down are therefore not the ids on
 * screen, and a cursor or a selection built from them reaches rows nobody can
 * see. Reading the rendered rows is the one answer that holds for every kind of
 * narrowing, wherever it happens.
 */
import { useCallback, useEffect, useState } from "react";

/** The marker a row carries the id the cursor and the selection know it by. */
export const MESSAGE_ROW_SELECTOR = "[data-message-id]";

const readRowIds = (container: HTMLElement): string[] =>
	Array.from(container.querySelectorAll<HTMLElement>(MESSAGE_ROW_SELECTOR))
		.map((row) => row.dataset.messageId)
		.filter((id): id is string => id !== undefined);

const sameIds = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The ids of the rows inside `container`, in document order, kept in step with
 * what it renders. `undefined` until a container has been read — a list whose
 * rows have not been counted yet is a different answer from a list with no
 * rows, and only the second one may empty a selection.
 *
 */
export function useRenderedRowIds(
	container: HTMLElement | null,
): string[] | undefined {
	const [rowIds, setRowIds] = useState<string[] | undefined>(undefined);

	const sync = useCallback(() => {
		if (!container) return;
		const next = readRowIds(container);
		setRowIds((prev) => (prev && sameIds(prev, next) ? prev : next));
	}, [container]);

	// Rows this render moved — a chip, an account pill, a completed verb — are in
	// the DOM by the time the commit's effects run.
	useEffect(sync);

	// Rows a section moves on its own — "Show N more", a collapsing header — never
	// reach this render at all, so nothing but the DOM reports them.
	useEffect(() => {
		if (!container) return;
		const observer = new MutationObserver(sync);
		observer.observe(container, { childList: true, subtree: true });
		return () => observer.disconnect();
	}, [container, sync]);

	return rowIds;
}
