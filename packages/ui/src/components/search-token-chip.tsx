import { X } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "../lib/cn.js";

/**
 * What the chip represents. A `scope` chip is the view the user is already in
 * (the folder they navigated to) rather than a filter they typed, so it is
 * visually differentiated — same removability, different provenance.
 */
export type SearchChipTone = "filter" | "scope";

export interface SearchTokenChipProps {
	label: string;
	onRemove: () => void;
	tone?: SearchChipTone;
	className?: string;
}

const toneClass: Record<SearchChipTone, string> = {
	filter: "border-line bg-surface-sunken text-fg-muted",
	scope: "border-accent-2/40 bg-accent-2-soft text-accent-2",
};

/**
 * One removable filter-token chip (`from:`, `has:attachment`, …) as a static
 * pill. Same dismissible treatment as `AddressTag`, generalized to a plain
 * label since a token chip carries no email identity.
 *
 * For chips inside the search field — where they are focusable and the
 * keyboard can remove them — use `SearchChipRow` instead.
 */
export const SearchTokenChip = ({
	label,
	onRemove,
	tone = "filter",
	className,
}: SearchTokenChipProps) => (
	<span
		className={cn(
			"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs",
			toneClass[tone],
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

export interface SearchChipRowProps {
	label: string;
	onRemove: () => void;
	/** Opens the chip's own editor, where the host offers one. */
	onActivate?: () => void;
	tone?: SearchChipTone;
	/** True for the one chip in the roving tab order (see `SearchChipInput`). */
	focused?: boolean;
	onKeyDown?: (event: React.KeyboardEvent) => void;
	onFocusLabel?: () => void;
	className?: string;
}

/**
 * One chip inside the search field, as a `row` of the enclosing `grid`.
 *
 * The label and the remove button are separate `gridcell`s so a screen reader
 * announces the chip and its removal as two distinct actions — M3's
 * requirement for a chip that carries a remove affordance. Only the label cell
 * takes part in the roving tab order; the remove button stays reachable by
 * pointer and by the Backspace/Delete route on the focused chip, which keeps
 * the field a single Tab stop.
 */
export const SearchChipRow = forwardRef<HTMLButtonElement, SearchChipRowProps>(
	(
		{
			label,
			onRemove,
			onActivate,
			tone = "filter",
			focused = false,
			onKeyDown,
			onFocusLabel,
			className,
		},
		ref,
	) => (
		// biome-ignore lint/a11y/useSemanticElements: grid pattern, not tabular data
		<span
			role="row"
			// Not a tab stop itself — the cells inside it are. Present so the row is
			// programmatically focusable, as its role implies.
			tabIndex={-1}
			className={cn(
				"inline-flex max-w-48 items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors",
				toneClass[tone],
				focused && "ring-2 ring-ring",
				className,
			)}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: see the row */}
			<button
				ref={ref}
				type="button"
				role="gridcell"
				// Roving tabindex: exactly one chip (or the text input) is in the tab
				// order at a time, so the whole field is one Tab stop.
				tabIndex={focused ? 0 : -1}
				onClick={onActivate}
				onFocus={onFocusLabel}
				onKeyDown={onKeyDown}
				className={cn(
					"block min-w-0 max-w-full truncate rounded-full outline-none",
					onActivate ? "cursor-pointer" : "cursor-default",
				)}
			>
				{label}
			</button>
			{/* biome-ignore lint/a11y/useSemanticElements: see the row */}
			<button
				type="button"
				role="gridcell"
				tabIndex={-1}
				onClick={onRemove}
				// Deliberately not wired to the roving handler. Should this button take
				// focus — a click, or assistive tech moving to it — that handler would
				// read Enter/Space as "activate the chip" and preventDefault them,
				// swallowing the button's own click. Its native activation is the
				// remove action already.
				className="block shrink-0 rounded-full p-0.5 transition-colors hover:bg-fg-muted/20"
				aria-label={`Remove filter: ${label}`}
			>
				<X className="size-3" />
			</button>
		</span>
	),
);
SearchChipRow.displayName = "SearchChipRow";

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
