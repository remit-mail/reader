import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import { preventsDefault, resolveChipKey } from "./search-chip-keys.js";
import { SearchTokenChip } from "./search-token-chip.js";

/**
 * One narrowing term of the search expression, pinned ahead of the free text.
 * `id` is the removal handle — stable across renders, and what the host keys
 * its own token state by.
 */
export interface SearchChip {
	id: string;
	label: string;
}

export interface SearchChipInputProps {
	/**
	 * The narrowing terms, in expression order. Chips are host-owned: this
	 * component never promotes typed text into a chip (see the module note on
	 * chips vs typed operators).
	 */
	chips?: readonly SearchChip[];
	onRemoveChip?: (id: string) => void;
	/** The free text after the chips. */
	value: string;
	onChange: (value: string) => void;
	/**
	 * Full clear (X button): the consumer resets the query AND any open thread
	 * so the view returns to the plain list with nothing pre-opened (#538).
	 */
	onClear: () => void;
	/**
	 * Query-only clear (Esc key): resets just the query and leaves any open
	 * thread untouched — one keypress, one effect (#489). Falls back to
	 * `onClear` when omitted.
	 */
	onClearQuery?: () => void;
	placeholder?: string;
	/**
	 * Bind the global "/" shortcut that focuses the field from anywhere on the
	 * page. Defaults to true; set false where a page hosts more than one bar.
	 */
	globalFocusKey?: boolean;
	/**
	 * Show the inline clear (X) at the end of the field. Defaults to true. Set
	 * false in the mobile takeover, where a single outer X owns clear-and-close
	 * so there is exactly one X (Esc still clears the query).
	 */
	showClearButton?: boolean;
	/**
	 * `sm` (default) is the compact field used in list headers and the mobile
	 * takeover. `lg` is the taller, rounder field the global top bar wants.
	 */
	size?: "sm" | "lg";
	/** DOM id of the text input. Defaults to `mail-search`. */
	inputId?: string;
	className?: string;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.tagName === "INPUT" ||
		target.tagName === "TEXTAREA" ||
		target.isContentEditable
	);
};

/**
 * The search field as a single editable expression: removable chips inline
 * ahead of the caret, free text after them, one focus ring around the whole
 * thing.
 *
 * **Chips vs typed operators.** Typing `in:spam` leaves plain text — it is not
 * promoted to a chip. Chips come from structured intent (the route you are
 * viewing, a filter panel, a suggestion), matching Gmail, where the search box
 * only ever chips terms the product itself committed. This keeps the typed
 * query honest: what you see in the text is exactly what you typed.
 *
 * **Keyboard.** The standard chip-input contract (Material, CoreUI, Angular
 * Material all agree), so deletion is never a surprise:
 *   - Backspace with the caret at position 0 selects the preceding chip;
 *     pressing it again removes that chip. Two steps, never one.
 *   - ArrowLeft at position 0 selects the preceding chip; ArrowRight (or
 *     typing, or any caret move) returns to the text.
 *   - Escape deselects a selected chip; with nothing selected it clears the
 *     query, and on an empty query it blurs.
 *
 * DOM focus stays on the real text input throughout — chips are marked with
 * `aria-selected` and announced through a live region rather than becoming
 * focus stops, so typing is never interrupted mid-expression.
 */
export const SearchChipInput = ({
	chips = [],
	onRemoveChip,
	value,
	onChange,
	onClear,
	onClearQuery,
	placeholder = "Search mail...",
	globalFocusKey = true,
	showClearButton = true,
	size = "sm",
	inputId = "mail-search",
	className,
}: SearchChipInputProps) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const clearQuery = onClearQuery ?? onClear;
	const [selectedChipId, setSelectedChipId] = useState<string | null>(null);

	// A chip removed by any route (X, keyboard, host state change) must not leave
	// a dangling selection pointing at an id that no longer exists.
	const hasSelectedChip = chips.some((chip) => chip.id === selectedChipId);
	useEffect(() => {
		if (!hasSelectedChip && selectedChipId !== null) setSelectedChipId(null);
	}, [hasSelectedChip, selectedChipId]);

	const focusInput = useCallback(() => {
		inputRef.current?.focus();
	}, []);

	const removeChip = useCallback(
		(id: string) => {
			setSelectedChipId(null);
			onRemoveChip?.(id);
			focusInput();
		},
		[onRemoveChip, focusInput],
	);

	const handleClear = useCallback(() => {
		setSelectedChipId(null);
		onClear();
		focusInput();
	}, [onClear, focusInput]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			const input = event.currentTarget;
			const action = resolveChipKey({
				key: event.key,
				caretAtStart: input.selectionStart === 0 && input.selectionEnd === 0,
				hasValue: value.length > 0,
				selectedChipId,
				lastChipId: chips.at(-1)?.id ?? null,
			});
			if (preventsDefault(action)) event.preventDefault();

			switch (action.type) {
				case "selectChip":
					setSelectedChipId(action.id);
					return;
				case "removeChip":
					removeChip(action.id);
					return;
				case "deselect":
					setSelectedChipId(null);
					return;
				case "clearQuery":
					clearQuery();
					return;
				case "blur":
					input.blur();
					return;
				case "none":
					return;
			}
		},
		[chips, selectedChipId, value, clearQuery, removeChip],
	);

	useEffect(() => {
		if (!globalFocusKey) return;
		const handleGlobalSlash = (event: KeyboardEvent) => {
			if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}
			if (isEditableTarget(event.target)) return;
			event.preventDefault();
			inputRef.current?.focus();
		};
		window.addEventListener("keydown", handleGlobalSlash);
		return () => window.removeEventListener("keydown", handleGlobalSlash);
	}, [globalFocusKey]);

	const selectedChip = chips.find((chip) => chip.id === selectedChipId);
	const hasChips = chips.length > 0;

	return (
		// A <label> so pressing anywhere on the field — its padding, the gap after
		// the chips — puts the caret in the text, natively and without a handler.
		// Presses on the chips' own buttons are interactive descendants, so they act
		// on the chip instead. The input's `aria-label` still wins the accessible
		// name, so the chip text never leaks into it.
		<label
			htmlFor={inputId}
			className={cn(
				"relative flex w-full items-center gap-1.5 text-sm",
				"bg-surface-sunken/50 border border-transparent",
				"focus-within:bg-canvas focus-within:border-line focus-within:ring-2 focus-within:ring-ring",
				"transition-colors",
				size === "lg" ? "rounded-xl px-4 py-2.5" : "rounded-md px-2.5 py-1.5",
				className,
			)}
		>
			<Search
				className={cn(
					"shrink-0 text-fg-muted pointer-events-none",
					size === "lg" ? "size-5" : "size-4",
				)}
			/>
			<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
				{chips.map((chip) => (
					<SearchTokenChip
						key={chip.id}
						label={chip.label}
						selected={chip.id === selectedChipId}
						onSelect={() => setSelectedChipId(chip.id)}
						onRemove={() => removeChip(chip.id)}
						className="shrink-0"
					/>
				))}
				<input
					ref={inputRef}
					id={inputId}
					name="q"
					type="text"
					aria-label="Search mail"
					autoComplete="off"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleKeyDown}
					// Once the expression carries chips the field is self-describing;
					// a placeholder there would read as another term.
					placeholder={hasChips ? undefined : placeholder}
					className={cn(
						"min-w-24 flex-1 bg-transparent text-fg outline-none",
						"placeholder:text-fg-muted",
					)}
				/>
			</div>
			{(value || hasChips) && showClearButton && (
				<button
					type="button"
					onClick={handleClear}
					className="shrink-0 rounded p-0.5 hover:bg-surface-raised transition-colors"
					aria-label="Clear search"
				>
					<X
						className={cn("text-fg-muted", size === "lg" ? "size-5" : "size-4")}
					/>
				</button>
			)}
			<span role="status" aria-live="polite" className="sr-only">
				{selectedChip
					? `${selectedChip.label} selected. Press Backspace to remove.`
					: ""}
			</span>
		</label>
	);
};
