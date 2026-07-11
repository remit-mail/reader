import { X } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface SearchTokenChipProps {
	label: string;
	onRemove: () => void;
	className?: string;
}

/**
 * One removable filter-token chip (`from:`, `has:attachment`, …) shown under
 * the search field once the field's typed text parses a recognized token.
 * Same dismissible-pill treatment as `AddressTag`, generalized to a plain
 * label since a token chip carries no email identity.
 */
export const SearchTokenChip = ({
	label,
	onRemove,
	className,
}: SearchTokenChipProps) => (
	<span
		className={cn(
			"inline-flex items-center gap-1 rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-2xs text-fg-muted",
			className,
		)}
	>
		<span>{label}</span>
		<button
			type="button"
			onClick={onRemove}
			className="shrink-0 rounded-full p-0.5 hover:bg-fg-muted/20 transition-colors"
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
