import { type RefObject, useEffect } from "react";

/** Arrow-key axis a roving-focus group listens on. */
export type RovingOrientation = "vertical" | "horizontal";

/**
 * Marks the focusable element of a message-list row. Spread it onto the row's
 * own control so the list's arrow-key cursor walks rows and steps over the
 * controls nested inside them (a row's retry/delete actions, a section header).
 */
export const LIST_ROW_ATTRIBUTE = { "data-list-row": "" } as const;

/** Selector matching {@link LIST_ROW_ATTRIBUTE}. */
export const LIST_ROW_SELECTOR = "[data-list-row]";

/**
 * Next index for a roving-tabindex group given a keystroke, the current index,
 * and the item count. Clamps at both ends; `Home`/`End` jump regardless of
 * orientation. Returns null when the key is not one the group owns.
 */
export function rovingNextIndex(
	key: string,
	currentIndex: number,
	itemCount: number,
	orientation: RovingOrientation = "vertical",
): number | null {
	if (itemCount === 0) return null;
	const forwardKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
	const backwardKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
	if (key === forwardKey) {
		return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, itemCount - 1);
	}
	if (key === backwardKey) {
		return currentIndex <= 0 ? 0 : currentIndex - 1;
	}
	if (key === "Home") return 0;
	if (key === "End") return itemCount - 1;
	return null;
}

export interface UseRovingFocusOptions {
	containerRef: RefObject<HTMLElement | null>;
	/** CSS selector, scoped to the container, matching every roving item. */
	itemSelector: string;
	orientation?: RovingOrientation;
}

function rovingItems(
	container: HTMLElement,
	itemSelector: string,
): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
}

/**
 * Arrow-key traversal over the focusable items inside a container, with a
 * roving tabindex so Tab reaches the group at one stop and Up/Down (or
 * Left/Right) walk it from there. Pass the container's ref; the hook binds its
 * own listeners to it.
 *
 * Items are discovered by querying the DOM rather than threading an index
 * through every component that renders one: the nav sidebar builds its entries
 * across collapsible per-account subsections, and the brief's rows come from a
 * consumer-supplied row component, so neither has a flat array to index into.
 *
 * A handled key stops propagating, so a window-level keyboard layer above the
 * group does not act on the same press.
 */
export function useRovingFocus({
	containerRef,
	itemSelector,
	orientation = "vertical",
}: UseRovingFocusOptions): void {
	// No dependency array: items appear and disappear as sections expand, rows
	// load, or filters change, none of which this hook's own inputs describe.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const syncTabIndex = () => {
			const items = rovingItems(container, itemSelector);
			if (items.length === 0) return;
			const focused = items.find((item) => item === document.activeElement);
			const active = focused ?? items[0];
			for (const item of items) {
				item.tabIndex = item === active ? 0 : -1;
			}
		};

		const onKeyDown = (event: KeyboardEvent) => {
			const items = rovingItems(container, itemSelector);
			const currentIndex = items.indexOf(document.activeElement as HTMLElement);
			const nextIndex = rovingNextIndex(
				event.key,
				currentIndex,
				items.length,
				orientation,
			);
			if (nextIndex === null || nextIndex === currentIndex) return;
			event.preventDefault();
			event.stopPropagation();
			items[nextIndex]?.focus();
		};

		syncTabIndex();
		container.addEventListener("focusin", syncTabIndex);
		container.addEventListener("keydown", onKeyDown);
		return () => {
			container.removeEventListener("focusin", syncTabIndex);
			container.removeEventListener("keydown", onKeyDown);
		};
	});
}
