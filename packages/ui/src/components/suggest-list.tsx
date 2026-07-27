import { cn } from "../lib/cn.js";

export interface Suggestion {
	/** The value the field takes when this option is picked. */
	value: string;
	/** What the row reads. Defaults to the value. */
	label?: string;
	/** Secondary text on the row — the address behind a display name, say. */
	hint?: string;
	/** Where the suggestion came from, when that is worth saying ("selected"). */
	source?: string;
}

export interface SuggestListProps {
	id: string;
	suggestions: readonly Suggestion[];
	/** The highlighted option, `-1` when the typed value is what stands. */
	activeIndex: number;
	optionId: (index: number) => string;
	onPick: (suggestion: Suggestion) => void;
	onHighlight: (index: number) => void;
	/** Names the list for screen readers. */
	label: string;
	className?: string;
}

/**
 * The suggestion listbox behind a typeahead field — markup only. The open state,
 * the highlight, and the keyboard live in `useSuggestList`, so every typeahead in
 * the app shares one behaviour and one look.
 *
 * The caller places it. Under the field in normal flow is the default worth
 * reaching for on a surface a phone uses: it takes its own space rather than
 * covering the field, so a soft keyboard cannot hide what was typed.
 */
export function SuggestList({
	id,
	suggestions,
	activeIndex,
	optionId,
	onPick,
	onHighlight,
	label,
	className,
}: SuggestListProps) {
	if (suggestions.length === 0) return null;
	return (
		<div
			id={id}
			role="listbox"
			aria-label={label}
			className={cn(
				"max-h-44 overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-sm",
				className,
			)}
		>
			{suggestions.map((suggestion, index) => (
				<div
					key={suggestion.value}
					id={optionId(index)}
					role="option"
					// The combobox input keeps focus throughout and points at the
					// highlighted option with aria-activedescendant; an option that took
					// focus itself would close the soft keyboard mid-typing.
					tabIndex={-1}
					aria-selected={index === activeIndex}
					className={cn(
						"flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm text-fg",
						index === activeIndex && "bg-accent-2-soft",
					)}
					// Pointer-down rather than click: the field must not lose focus and
					// run its blur handling before the pick lands.
					onMouseDown={(event) => {
						event.preventDefault();
						onPick(suggestion);
					}}
					onMouseEnter={() => onHighlight(index)}
				>
					<span className="min-w-0 flex-1 truncate">
						{suggestion.label ?? suggestion.value}
					</span>
					{suggestion.hint && (
						<span className="shrink-0 truncate text-2xs text-fg-subtle">
							{suggestion.hint}
						</span>
					)}
					{suggestion.source && (
						<span className="shrink-0 text-2xs text-fg-subtle">
							{suggestion.source}
						</span>
					)}
				</div>
			))}
		</div>
	);
}
