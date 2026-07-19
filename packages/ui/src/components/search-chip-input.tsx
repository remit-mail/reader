import { Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import {
	type ChipFocusTarget,
	focusAfterRemoval,
	resolveChipInputKey,
	resolveChipKey,
} from "./search-chip-keys.js";
import { SearchChipRow, type SearchChipTone } from "./search-token-chip.js";

/**
 * One narrowing term of the search expression, pinned ahead of the free text.
 * `id` is the removal handle — stable across renders, and what the host keys
 * its own token state by.
 */
export interface SearchChip {
	id: string;
	label: string;
	/** `scope` marks the view the user navigated into. See `SearchChipTone`. */
	tone?: SearchChipTone;
}

export interface SearchChipInputProps {
	/**
	 * The narrowing terms, in expression order. Chips are host-owned: this
	 * component never turns typed text into a chip (see the module note on chip
	 * creation).
	 */
	chips?: readonly SearchChip[];
	onRemoveChip?: (id: string) => void;
	/** Opens a chip's own value editor, where the host offers one. */
	onActivateChip?: (id: string) => void;
	/** The free text alongside the chips. */
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
	/**
	 * DOM id of the text input. Defaults to a generated, per-instance id — a
	 * fixed default would collide wherever two fields are mounted at once, and
	 * the enclosing <label for> would then aim at the wrong one. Pass this only
	 * when something outside needs to address the field by a stable id.
	 */
	inputId?: string;
	/** Accessible name for the chip grid. */
	chipsLabel?: string;
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
 * The search field as one editable expression: removable chips inline ahead of
 * the free text, a single focus ring around the whole thing, one Tab stop.
 *
 * **Chip creation.** This component does not create chips. Typing `in:spam`
 * leaves plain text; chips arrive from structured intent the host commits — the
 * view being navigated to, a filter menu, a suggestion. Keeping the parse on
 * the host side means the field never has to guess whether text was meant as an
 * operator, and the host owns the one requirement that matters: chips plus the
 * remaining text must serialise back to exactly the query the user meant.
 *
 * **Keyboard.** Focus roves between the text input and the chips, and the
 * meaning of a key follows it:
 *   - Backspace (or ArrowLeft) with the caret at the start of the text moves
 *     focus onto the preceding chip. Backspace again removes it — two presses,
 *     so a term is never lost to a stray keystroke.
 *   - On a focused chip: Backspace/Delete removes, Left/Right walk the chips,
 *     Right past the last one returns to the text, Escape returns to the text.
 *   - Shift+Tab from the text steps back into the chips rather than leaving.
 *   - After a removal, focus lands on the chip that took its place, else the
 *     one before it, else the text input.
 *
 * Removal is never keyboard-only: every chip carries a remove button, which is
 * what touch and soft-keyboard users need (a soft keyboard gives no reliable
 * Backspace-into-chip signal).
 *
 * **Semantics.** The chips form a `grid` of one-`row`-per-chip, each with a
 * label `gridcell` and a remove `gridcell`, and the text input is a sibling of
 * that grid. ARIA has no chips/tokens pattern, so this follows Material Design
 * 3's chip accessibility guidance and Angular Material's `mat-chip-grid` — an
 * adaptation, to be settled by screen-reader testing rather than role names.
 */
export const SearchChipInput = ({
	chips = [],
	onRemoveChip,
	onActivateChip,
	value,
	onChange,
	onClear,
	onClearQuery,
	placeholder = "Search mail...",
	globalFocusKey = true,
	showClearButton = true,
	size = "sm",
	inputId,
	chipsLabel = "Search filters",
	className,
}: SearchChipInputProps) => {
	// The field wraps itself in a <label for>, and `for` binds to the FIRST
	// matching id in tree order. A shared default would therefore aim every
	// mounted field's label at whichever one rendered first — the desktop layout
	// mounts two at once. A generated id per instance makes that unrepresentable.
	const generatedId = useId();
	const resolvedInputId = inputId ?? generatedId;
	const inputRef = useRef<HTMLInputElement>(null);
	const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const clearQuery = onClearQuery ?? onClear;
	/** Which chip holds focus; null means the text input does. */
	const [focusedChip, setFocusedChip] = useState<ChipFocusTarget>(null);
	/** Where focus must be moved after the next render, if anywhere. */
	const pendingFocus = useRef<ChipFocusTarget | undefined>(undefined);
	const [announcement, setAnnouncement] = useState("");

	const hasChips = chips.length > 0;

	// A chip list that shrinks from under the focused index (the host removed one,
	// or the route changed) must not strand the roving tab order out of bounds.
	useEffect(() => {
		setFocusedChip((current) =>
			current !== null && current >= chips.length ? null : current,
		);
	}, [chips.length]);

	// Focus moves are queued during the keydown and applied once the new chip set
	// has rendered, so the element being focused actually exists.
	useEffect(() => {
		const target = pendingFocus.current;
		if (target === undefined) return;
		pendingFocus.current = undefined;
		if (target === null) {
			inputRef.current?.focus();
			return;
		}
		chipRefs.current[target]?.focus();
	});

	const moveFocus = useCallback((target: ChipFocusTarget) => {
		setFocusedChip(target);
		pendingFocus.current = target;
	}, []);

	const removeChipAt = useCallback(
		(index: number) => {
			const chip = chips[index];
			if (!chip) return;
			moveFocus(focusAfterRemoval(index, chips.length));
			setAnnouncement(`${chip.label} removed`);
			onRemoveChip?.(chip.id);
		},
		[chips, onRemoveChip, moveFocus],
	);

	const handleClear = useCallback(() => {
		moveFocus(null);
		onClear();
	}, [onClear, moveFocus]);

	const handleInputKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			const input = event.currentTarget;
			const action = resolveChipInputKey({
				key: event.key,
				shiftKey: event.shiftKey,
				repeat: event.repeat,
				caretAtStart: input.selectionStart === 0 && input.selectionEnd === 0,
				hasValue: value.length > 0,
				chipCount: chips.length,
			});

			switch (action.type) {
				case "focusChip":
					event.preventDefault();
					moveFocus(action.index);
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
		[chips.length, value, clearQuery, moveFocus],
	);

	const handleChipKeyDown = useCallback(
		(index: number) => (event: React.KeyboardEvent) => {
			const action = resolveChipKey({
				key: event.key,
				repeat: event.repeat,
				index,
				chipCount: chips.length,
			});
			if (action.type !== "none") event.preventDefault();

			switch (action.type) {
				case "removeChip":
					removeChipAt(action.index);
					return;
				case "focusChip":
					moveFocus(action.index);
					return;
				case "focusInput":
					moveFocus(null);
					return;
				case "activateChip": {
					const chip = chips[action.index];
					if (chip && onActivateChip) onActivateChip(chip.id);
					return;
				}
				case "none":
					return;
			}
		},
		[chips, removeChipAt, moveFocus, onActivateChip],
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

	return (
		// A <label> so pressing the field's own padding puts the caret in the text,
		// natively and without a handler. Presses on the chips' buttons are
		// interactive descendants, so they act on the chip instead. The input's
		// `aria-label` still wins the accessible name, so chip text never leaks
		// into it.
		<label
			htmlFor={resolvedInputId}
			className={cn(
				"flex w-full items-center gap-1.5 text-sm",
				"bg-surface-sunken/50 border border-transparent",
				"focus-within:bg-canvas focus-within:border-line focus-within:ring-2 focus-within:ring-ring",
				"transition-colors",
				size === "lg" ? "rounded-xl px-4 py-2" : "rounded-md px-2.5 py-1",
				className,
			)}
		>
			<Search
				className={cn(
					"shrink-0 text-fg-muted pointer-events-none",
					size === "lg" ? "size-5" : "size-4",
				)}
			/>
			{/* Chips wrap onto further lines rather than stacking or clipping, and
			    the text input is a sibling of the grid, not a cell inside it. */}
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
				{hasChips && (
					// Not tabular data, and <table> cannot live inside a text field. See
					// SearchChipRow for why grid is the pattern being adapted here.
					// biome-ignore lint/a11y/useSemanticElements: see above
					<div
						role="grid"
						aria-label={chipsLabel}
						className="flex min-w-0 flex-wrap items-center gap-1"
					>
						{chips.map((chip, index) => (
							<SearchChipRow
								key={chip.id}
								ref={(node) => {
									chipRefs.current[index] = node;
								}}
								label={chip.label}
								tone={chip.tone}
								focused={focusedChip === index}
								onFocusLabel={() => setFocusedChip(index)}
								onKeyDown={handleChipKeyDown(index)}
								onRemove={() => removeChipAt(index)}
								onActivate={
									onActivateChip ? () => onActivateChip(chip.id) : undefined
								}
							/>
						))}
					</div>
				)}
				<input
					ref={inputRef}
					id={resolvedInputId}
					name="q"
					type="text"
					aria-label="Search mail"
					autoComplete="off"
					value={value}
					tabIndex={focusedChip === null ? 0 : -1}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={handleInputKeyDown}
					onFocus={() => setFocusedChip(null)}
					// Once the expression carries chips the field is self-describing; a
					// placeholder there would read as another term.
					placeholder={hasChips ? undefined : placeholder}
					className="min-w-24 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-muted"
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
			{/* A removal that says nothing is the most common failure of this
			    pattern, so every one is announced. */}
			<span role="status" aria-live="polite" className="sr-only">
				{announcement}
			</span>
		</label>
	);
};
