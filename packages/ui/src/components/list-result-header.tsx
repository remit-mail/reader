import { Search } from "lucide-react";

/**
 * How many rows match a search, as the server answered it.
 *
 * `exact` is the whole match set — the number does not move as the reader pages.
 * `unknown` is every other case: the count was not requested, has not arrived,
 * or the criteria carry an off-row term the server will not count exactly
 * (`senderTrust`, `dkimMismatch`). It renders as no number at all.
 *
 * A union rather than an optional number, so a page length cannot be handed to
 * this component by accident: there is no shape here that accepts one.
 */
export type ResultCount =
	| { kind: "exact"; value: number }
	| { kind: "unknown" };

export interface ListResultHeaderProps {
	/** The query as the reader typed it, quoted back to them. */
	query: string;
	count: ResultCount;
}

const formatCount = (n: number): string => n.toLocaleString();

const resultsLabel = (count: ResultCount, query: string): string => {
	if (count.kind === "unknown") return `Results for “${query}”`;
	const noun = count.value === 1 ? "result" : "results";
	return `${formatCount(count.value)} ${noun} for “${query}”`;
};

/**
 * Names what the list is showing, and how much of it there is.
 *
 * The number is the server's count of the whole match set, never the length of
 * the pages fetched so far: a page length presented as a total contradicts the
 * completeness the filtered empty state states in the same view (#307).
 */
export function ListResultHeader({ query, count }: ListResultHeaderProps) {
	return (
		<div className="flex items-center gap-2 border-b border-line bg-surface-sunken/30 px-3 py-2">
			<Search className="size-4 text-fg-muted" aria-hidden="true" />
			<span className="text-sm text-fg-muted">
				{resultsLabel(count, query)}
			</span>
		</div>
	);
}
