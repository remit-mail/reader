import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useState,
} from "react";
import { suggestKeyAction } from "./suggest-keys.js";

export interface UseSuggestListInput {
	/** How many suggestions are on offer right now. */
	count: number;
	/** Take the suggestion at this index. */
	onAccept: (index: number) => void;
	/** Extra keys that take the highlighted suggestion — see `suggestKeyAction`. */
	acceptKeys?: readonly string[];
}

/** The ARIA wiring a combobox input spreads onto itself. */
export interface ComboboxProps {
	role: "combobox";
	"aria-expanded": boolean;
	"aria-controls": string;
	"aria-autocomplete": "list";
	"aria-activedescendant"?: string;
	/**
	 * Marks the field as owning Escape while its list is open, so a surrounding
	 * dialog closes on Escape only when the list is not the thing to close.
	 */
	"data-escape-owner"?: "";
}

export interface SuggestListState {
	/** Whether the list should render. */
	open: boolean;
	/** The highlighted option, `-1` when the typed value is what stands. */
	activeIndex: number;
	setActiveIndex: (index: number) => void;
	/** Close the list, keeping whatever is typed. */
	dismiss: () => void;
	/** Offer the list again — what a fresh keystroke does after a dismissal. */
	reopen: () => void;
	/** Returns true when the list consumed the key and the caller should stop. */
	handleKeyDown: (event: KeyboardEvent) => boolean;
	listId: string;
	optionId: (index: number) => string;
	comboboxProps: ComboboxProps;
}

/**
 * The open/highlight state, ARIA wiring, and keyboard handling behind a
 * suggestion list, so every typeahead in the app behaves the same way and there
 * is one place the behaviour is defined. The caller owns the data, the markup,
 * and what a picked suggestion means; this owns only which option is highlighted
 * and whether the list is showing.
 *
 * Nothing here writes the field's value — a dismissal, a re-render, or an empty
 * result leaves what the user typed exactly as it is.
 */
export function useSuggestList({
	count,
	onAccept,
	acceptKeys,
}: UseSuggestListInput): SuggestListState {
	const [dismissed, setDismissed] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const listId = `suggest-${base}`;
	const optionId = useCallback(
		(index: number) => `suggest-${base}-option-${index}`,
		[base],
	);

	// A changed result set is a new list: no highlight carries over onto an option
	// the user never saw, and a list dismissed for the previous query is offered
	// again for this one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `count` is the trigger, not a value the effect reads — a different result set is what resets the list
	useEffect(() => {
		setActiveIndex(-1);
		setDismissed(false);
	}, [count]);

	const open = count > 0 && !dismissed;

	const handleKeyDown = useCallback(
		(event: KeyboardEvent): boolean => {
			const action = suggestKeyAction({
				key: event.key,
				open,
				count,
				activeIndex,
				acceptKeys,
			});
			if (action.type === "none") return false;
			event.preventDefault();
			if (action.type === "move") setActiveIndex(action.index);
			if (action.type === "dismiss") setDismissed(true);
			if (action.type === "accept") onAccept(action.index);
			return true;
		},
		[open, count, activeIndex, acceptKeys, onAccept],
	);

	return {
		open,
		activeIndex,
		setActiveIndex,
		dismiss: useCallback(() => setDismissed(true), []),
		reopen: useCallback(() => setDismissed(false), []),
		handleKeyDown,
		listId,
		optionId,
		comboboxProps: {
			role: "combobox",
			"aria-expanded": open,
			"aria-controls": listId,
			"aria-autocomplete": "list",
			...(activeIndex >= 0
				? { "aria-activedescendant": optionId(activeIndex) }
				: {}),
			...(open ? { "data-escape-owner": "" as const } : {}),
		},
	};
}
