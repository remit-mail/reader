import { Search } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "../lib/cn.js";
import { Input } from "./input.js";

export interface MoveMailboxOption {
	/** Stable identity passed back to `onSelect`. */
	id: string;
	/** Display label shown in the row and matched against the search query. */
	label: string;
	/**
	 * The message's current folder. Rendered as a non-selectable row so the
	 * user sees where the message lives but can't move it onto itself.
	 */
	isCurrent?: boolean;
	/**
	 * Optional secondary string matched alongside `label` (e.g. the full
	 * folder path so "gmail/" narrows nested folders). Never displayed.
	 */
	searchValue?: string;
}

export interface MoveMailboxPickerLabels {
	/** Search input placeholder. */
	searchPlaceholder?: string;
	/** Accessible label for the search input. */
	searchAriaLabel?: string;
	/** Accessible label for the listbox. */
	listAriaLabel?: string;
	/** Suffix announced for the current folder, e.g. `(current folder)`. */
	currentSuffix?: string;
	/** Inline tag shown on the current folder row. */
	currentTag?: string;
	/** Builds the empty-state message for a query that matches nothing. */
	emptyMessage?: (query: string) => string;
	/** Builds the accessible label for a selectable row, e.g. `Move to X`. */
	optionLabel?: (label: string) => string;
}

export interface MoveMailboxPickerProps {
	/**
	 * Destinations to show, already filtered, ordered and labeled by the app.
	 * The kit owns only search, focus and keyboard — never data shaping.
	 */
	mailboxes: readonly MoveMailboxOption[];
	onSelect: (mailboxId: string) => void;
	/**
	 * Called when the user dismisses the picker via Escape. Trigger consumers
	 * use this to close their popover/drawer; the picker never owns
	 * presentation, so it cannot close itself without help.
	 */
	onCancel?: () => void;
	/**
	 * Mobile callers (bottom-sheet) pass `autoFocus` to focus the search input
	 * as soon as the sheet opens — keyboard accessory + immediate filter typing
	 * without an extra tap. Desktop dropdowns leave focus on the trigger so
	 * click-outside dismissal stays predictable.
	 */
	autoFocus?: boolean;
	labels?: MoveMailboxPickerLabels;
}

const ROW_BASE =
	"w-full text-left px-3 py-2.5 min-h-11 flex items-center gap-2 transition-colors text-sm rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-canvas";

const defaultLabels: Required<MoveMailboxPickerLabels> = {
	searchPlaceholder: "Move to…",
	searchAriaLabel: "Filter folders",
	listAriaLabel: "Destination folders",
	currentSuffix: "(current folder)",
	currentTag: "current",
	emptyMessage: (query) => `No folders match "${query}"`,
	optionLabel: (label) => `Move to ${label}`,
};

const findFirstSelectable = (options: readonly MoveMailboxOption[]): number => {
	for (let i = 0; i < options.length; i += 1) {
		if (!options[i]?.isCurrent) return i;
	}
	return -1;
};

const findLastSelectable = (options: readonly MoveMailboxOption[]): number => {
	for (let i = options.length - 1; i >= 0; i -= 1) {
		if (!options[i]?.isCurrent) return i;
	}
	return -1;
};

const findNextSelectable = (
	options: readonly MoveMailboxOption[],
	from: number,
	step: 1 | -1,
): number => {
	const count = options.length;
	if (count <= 0) return -1;
	const start = from < 0 ? (step === 1 ? -1 : count) : from;
	for (let offset = 1; offset <= count; offset += 1) {
		const candidate = (((start + step * offset) % count) + count) % count;
		if (!options[candidate]?.isCurrent) return candidate;
	}
	return -1;
};

const matchesQuery = (option: MoveMailboxOption, query: string): boolean => {
	if (option.label.toLowerCase().includes(query)) return true;
	return option.searchValue?.toLowerCase().includes(query) ?? false;
};

/**
 * Move-to-folder destination picker: an always-on search input over a
 * roving-focus listbox. Data-agnostic — the app supplies pre-shaped,
 * pre-ordered options and performs the move in `onSelect`; the kit owns search
 * filtering, keyboard navigation and ARIA structure.
 */
export const MoveMailboxPicker = ({
	mailboxes,
	onSelect,
	onCancel,
	autoFocus = false,
	labels,
}: MoveMailboxPickerProps) => {
	const text = { ...defaultLabels, ...labels };
	const [query, setQuery] = useState("");
	const [focusedIndex, setFocusedIndex] = useState<number>(() =>
		findFirstSelectable(mailboxes),
	);
	const inputRef = useRef<HTMLInputElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	const trimmedQuery = query.trim().toLowerCase();
	const filtered = useMemo(() => {
		if (!trimmedQuery) return [...mailboxes];
		return mailboxes.filter((mailbox) => matchesQuery(mailbox, trimmedQuery));
	}, [mailboxes, trimmedQuery]);

	useEffect(() => {
		setFocusedIndex((current) => {
			if (
				current >= 0 &&
				current < filtered.length &&
				!filtered[current]?.isCurrent
			) {
				return current;
			}
			return findFirstSelectable(filtered);
		});
	}, [filtered]);

	useEffect(() => {
		if (focusedIndex < 0) return;
		const node = optionRefs.current[focusedIndex];
		if (!node) return;
		// Only steal focus if the user is already navigating the list — moving
		// focus while they type in the filter input would trap them. The search
		// input keeps focus until the first ArrowDown.
		if (document.activeElement === inputRef.current) return;
		node.focus();
	}, [focusedIndex]);

	const handleConfirm = useCallback(() => {
		if (focusedIndex < 0) return;
		const target = filtered[focusedIndex];
		if (!target || target.isCurrent) return;
		onSelect(target.id);
	}, [focusedIndex, filtered, onSelect]);

	const handleListKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			switch (event.key) {
				case "ArrowDown":
					event.preventDefault();
					setFocusedIndex((current) =>
						findNextSelectable(filtered, current, 1),
					);
					return;
				case "ArrowUp":
					event.preventDefault();
					setFocusedIndex((current) =>
						findNextSelectable(filtered, current, -1),
					);
					return;
				case "Home":
					event.preventDefault();
					setFocusedIndex(findFirstSelectable(filtered));
					return;
				case "End":
					event.preventDefault();
					setFocusedIndex(findLastSelectable(filtered));
					return;
				case "Enter":
				case " ":
					event.preventDefault();
					handleConfirm();
					return;
				case "Escape":
					event.preventDefault();
					onCancel?.();
					return;
				default:
					return;
			}
		},
		[filtered, handleConfirm, onCancel],
	);

	const handleInputKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				if (filtered.length === 0) return;
				const target = optionRefs.current[focusedIndex >= 0 ? focusedIndex : 0];
				target?.focus();
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				onCancel?.();
			}
		},
		[filtered.length, focusedIndex, onCancel],
	);

	return (
		<div className="flex flex-col">
			<Input
				variant="inline"
				className="border-b border-line px-3 py-2"
				icon={<Search className="size-4" aria-hidden="true" />}
				ref={inputRef}
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={handleInputKeyDown}
				placeholder={text.searchPlaceholder}
				aria-label={text.searchAriaLabel}
			/>
			<ul
				className="flex-1 overflow-y-auto py-1"
				role="listbox"
				aria-label={text.listAriaLabel}
				onKeyDown={handleListKeyDown}
			>
				{filtered.length === 0 ? (
					<li className="px-3 py-3 text-sm text-fg-muted" aria-live="polite">
						{text.emptyMessage(query)}
					</li>
				) : (
					filtered.map((mailbox, idx) => {
						const isCurrent = mailbox.isCurrent ?? false;
						const isFocused = idx === focusedIndex;
						// The current folder is a "you are here" marker, not a target —
						// rendered as a static option (never a disabled control) so the
						// user can see where the message lives without a dead button.
						// Selectable folders are real <button> options. Each interactive
						// element IS the listbox option: a role="option" <li> wrapping a
						// separately-interactive <button> is invalid ARIA.
						if (isCurrent) {
							return (
								<li key={mailbox.id}>
									<div
										role="option"
										aria-selected={false}
										aria-current="true"
										aria-label={`${mailbox.label} ${text.currentSuffix}`}
										className={cn(ROW_BASE, "opacity-60 bg-surface-sunken/40")}
									>
										<span className="truncate flex-1">{mailbox.label}</span>
										<span className="text-xs text-fg-muted shrink-0">
											{text.currentTag}
										</span>
									</div>
								</li>
							);
						}
						return (
							<li key={mailbox.id}>
								<button
									ref={(node) => {
										optionRefs.current[idx] = node;
									}}
									type="button"
									role="option"
									aria-selected={false}
									tabIndex={isFocused ? 0 : -1}
									onClick={() => onSelect(mailbox.id)}
									onFocus={() => setFocusedIndex(idx)}
									aria-label={text.optionLabel(mailbox.label)}
									className={cn(ROW_BASE, "hover:bg-surface-raised")}
								>
									<span className="truncate flex-1">{mailbox.label}</span>
								</button>
							</li>
						);
					})
				)}
			</ul>
		</div>
	);
};

/**
 * Pure selection/filter helpers exposed for unit testing the roving-focus and
 * search logic without a DOM. Component consumers should use
 * {@link MoveMailboxPicker} instead.
 */
export const moveMailboxPickerInternals = {
	findFirstSelectable,
	findLastSelectable,
	findNextSelectable,
	matchesQuery,
};
