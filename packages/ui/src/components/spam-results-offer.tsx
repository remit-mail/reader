import { Banner } from "./banner.js";
import { Button } from "./button.js";

export interface SpamResultsOfferProps {
	/** How many matches the search found in Spam. */
	count: number;
	/**
	 * Scope the search to Spam. This is a shortcut to the state reached by
	 * navigating to Spam with the query carried over — the same scoped search,
	 * with the same `in:spam` chip — not a separate result mode.
	 */
	onScopeToSpam: () => void;
}

const plural = (n: number): string => (n === 1 ? "result" : "results");

/**
 * Spam matches held out of a global search, offered rather than mixed in. Spam
 * is the one folder a search that reaches everywhere does not inline, because
 * the whole point of the folder is that its contents are unwanted until asked
 * for. Taking the offer scopes the search to Spam.
 *
 * Quiet on purpose: this is an offer, not a warning. Presentational — the
 * caller owns what "scope to spam" does.
 */
export function SpamResultsOffer({
	count,
	onScopeToSpam,
}: SpamResultsOfferProps) {
	return (
		<Banner
			tone="info"
			variant="soft"
			className="items-center justify-between gap-3 rounded-none border-b border-line"
		>
			<div className="flex items-center justify-between gap-3">
				<p className="min-w-0 text-xs text-fg-muted">
					<span className="font-semibold text-fg tabular-nums">{count}</span>{" "}
					{`${plural(count)} from Spam`}
				</p>
				<Button
					variant="ghost"
					size="sm"
					onClick={onScopeToSpam}
					className="shrink-0 text-accent"
				>
					View them
				</Button>
			</div>
		</Banner>
	);
}
