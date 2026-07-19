import { X } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface SearchTokenChipProps {
	label: string;
	onRemove: () => void;
	/**
	 * Marks the chip as the one a keyboard deletion acts on next — the
	 * intermediate state of the two-step backspace in `SearchChipInput`. Uses the
	 * secondary accent, the token set's selection colour.
	 */
	selected?: boolean;
	/**
	 * Makes the chip's label pressable, selecting it rather than removing it.
	 * Omit for a static chip whose only control is the X.
	 */
	onSelect?: () => void;
	className?: string;
}

/**
 * One removable filter-token chip (`from:`, `has:attachment`, …). Same
 * dismissible-pill treatment as `AddressTag`, generalized to a plain label
 * since a token chip carries no email identity.
 *
 * Two placements: standalone under the search field (`SearchTokenChips`), and
 * inline inside the field as part of the narrowing expression
 * (`SearchChipInput`), where `selected` renders the pending-deletion state.
 */
export const SearchTokenChip = ({
	label,
	onRemove,
	selected = false,
	onSelect,
	className,
}: SearchTokenChipProps) => (
	<span
		className={cn(
			"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors",
			selected
				? "border-accent-2 bg-accent-2-soft text-accent-2"
				: "border-line bg-surface-sunken text-fg-muted",
			className,
		)}
	>
		{onSelect ? (
			<button
				type="button"
				onClick={onSelect}
				// A toggle: pressed means "marked for deletion", the state the first
				// Backspace leaves the chip in. The text input keeps DOM focus so
				// typing is never interrupted — the chips are reached with the caret
				// keys, not the tab order.
				aria-pressed={selected}
				tabIndex={-1}
				className="cursor-default rounded-full"
			>
				{label}
			</button>
		) : (
			<span>{label}</span>
		)}
		<button
			type="button"
			onClick={onRemove}
			tabIndex={onSelect ? -1 : undefined}
			className={cn(
				"shrink-0 rounded-full p-0.5 transition-colors",
				selected ? "hover:bg-accent-2/20" : "hover:bg-fg-muted/20",
			)}
			aria-label={`Remove filter: ${label}`}
		>
			<X className="size-3" />
		</button>
	</span>
);

export interface SearchTokenChipsProps {
	tokens: { label: string; onRemove: () => void }[];
	className?: string;
}

/** Wraps the active filter-token chips in a row under the search field. */
export const SearchTokenChips = ({
	tokens,
	className,
}: SearchTokenChipsProps) => {
	if (tokens.length === 0) return null;
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-row-inset py-1.5",
				className,
			)}
		>
			{tokens.map((token) => (
				<SearchTokenChip
					key={token.label}
					label={token.label}
					onRemove={token.onRemove}
				/>
			))}
		</div>
	);
};
