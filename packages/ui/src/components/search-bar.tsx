import {
	type SearchChip,
	SearchChipInput,
	type SearchChipInputProps,
} from "./search-chip-input.js";

export type { SearchChip };

export interface SearchBarProps {
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
	/**
	 * Narrowing terms shown inline ahead of the typed text. Omit for a plain
	 * text field; see `SearchChipInput` for the expression semantics.
	 */
	chips?: readonly SearchChip[];
	onRemoveChip?: (id: string) => void;
	placeholder?: string;
	/**
	 * Bind the global "/" shortcut that focuses the field from anywhere on the
	 * page. Defaults to true; set false where a page hosts more than one bar.
	 */
	globalFocusKey?: boolean;
	/**
	 * Show the inline clear (X) inside the field. Defaults to true. Set false in
	 * the mobile takeover / collapsed header, where a single outer X owns
	 * clear-and-close so there is exactly one X (Esc still clears the query).
	 */
	showClearButton?: boolean;
	/** Field scale — `lg` for the global top bar. See `SearchChipInput`. */
	size?: SearchChipInputProps["size"];
	className?: string;
}

/**
 * The mail search field. A thin naming layer over `SearchChipInput`, which owns
 * the chips-plus-text expression and its keyboard contract; every search
 * surface (list header, mobile takeover, global top bar) renders this one
 * field so the behaviour cannot drift between them.
 */
export const SearchBar = ({
	value,
	onChange,
	onClear,
	onClearQuery,
	chips,
	onRemoveChip,
	placeholder = "Search mail...",
	globalFocusKey = true,
	showClearButton = true,
	size,
	className,
}: SearchBarProps) => (
	<SearchChipInput
		value={value}
		onChange={onChange}
		onClear={onClear}
		onClearQuery={onClearQuery}
		chips={chips}
		onRemoveChip={onRemoveChip}
		placeholder={placeholder}
		globalFocusKey={globalFocusKey}
		showClearButton={showClearButton}
		size={size}
		className={className}
	/>
);
