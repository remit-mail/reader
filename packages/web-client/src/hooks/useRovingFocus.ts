import { useCallback, useEffect, useState } from "react";

/**
 * Pure focus-state machine for keyboard navigation over a fixed-length list of
 * options, used by listbox-style components (e.g. MoveToMailboxPicker).
 *
 * The hook intentionally does not touch the DOM. The caller wires the returned
 * `index` into `tabIndex` / `aria-selected` and calls `focus()` on the matching
 * element from a `useEffect` keyed off `index`. Splitting concerns this way
 * keeps the state machine testable without a JSDOM/RTL setup.
 */
export interface UseRovingFocusOptions {
	/** Total number of focusable options. */
	count: number;
	/**
	 * Optional predicate marking individual indices unselectable (e.g. the
	 * currently-open folder in a move picker). Skipped indices are stepped
	 * over by arrow / Home / End and are never returned as `index`.
	 *
	 * Stable identity is not required — the hook re-derives the focus index
	 * whenever the predicate makes the current index unreachable.
	 */
	isDisabled?: (index: number) => boolean;
}

export interface UseRovingFocusResult {
	/** Currently focused option index, or -1 if no option is focusable. */
	index: number;
	/** Move focus to the next selectable option (wraps at end). */
	next: () => void;
	/** Move focus to the previous selectable option (wraps at start). */
	previous: () => void;
	/** Move focus to the first selectable option. */
	first: () => void;
	/** Move focus to the last selectable option. */
	last: () => void;
	/** Set focus to a specific index if it is selectable. */
	setIndex: (next: number) => void;
}

const findNextSelectable = (
	count: number,
	from: number,
	step: 1 | -1,
	isDisabled: (index: number) => boolean,
): number => {
	if (count <= 0) return -1;
	const start = from < 0 ? (step === 1 ? -1 : count) : from;
	for (let offset = 1; offset <= count; offset += 1) {
		const candidate = (((start + step * offset) % count) + count) % count;
		if (!isDisabled(candidate)) return candidate;
	}
	return -1;
};

const findFirstSelectable = (
	count: number,
	isDisabled: (index: number) => boolean,
): number => {
	for (let i = 0; i < count; i += 1) {
		if (!isDisabled(i)) return i;
	}
	return -1;
};

const findLastSelectable = (
	count: number,
	isDisabled: (index: number) => boolean,
): number => {
	for (let i = count - 1; i >= 0; i -= 1) {
		if (!isDisabled(i)) return i;
	}
	return -1;
};

export const useRovingFocus = ({
	count,
	isDisabled,
}: UseRovingFocusOptions): UseRovingFocusResult => {
	const disabledFn = isDisabled ?? (() => false);
	const [index, setStateIndex] = useState<number>(() =>
		findFirstSelectable(count, disabledFn),
	);

	useEffect(() => {
		if (count <= 0) {
			setStateIndex(-1);
			return;
		}
		setStateIndex((current) => {
			if (current >= 0 && current < count && !disabledFn(current)) {
				return current;
			}
			return findFirstSelectable(count, disabledFn);
		});
	}, [count, disabledFn]);

	const next = useCallback(() => {
		setStateIndex((current) =>
			findNextSelectable(count, current, 1, disabledFn),
		);
	}, [count, disabledFn]);

	const previous = useCallback(() => {
		setStateIndex((current) =>
			findNextSelectable(count, current, -1, disabledFn),
		);
	}, [count, disabledFn]);

	const first = useCallback(() => {
		setStateIndex(findFirstSelectable(count, disabledFn));
	}, [count, disabledFn]);

	const last = useCallback(() => {
		setStateIndex(findLastSelectable(count, disabledFn));
	}, [count, disabledFn]);

	const setIndex = useCallback(
		(value: number) => {
			if (value < 0 || value >= count) return;
			if (disabledFn(value)) return;
			setStateIndex(value);
		},
		[count, disabledFn],
	);

	return { index, next, previous, first, last, setIndex };
};

/**
 * Pure helpers exposed for unit testing the focus state machine without React.
 * Component consumers should use {@link useRovingFocus} instead.
 */
export const rovingFocusInternals = {
	findNextSelectable,
	findFirstSelectable,
	findLastSelectable,
};
