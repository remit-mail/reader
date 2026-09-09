import { Banner } from "./banner.js";
import { Button } from "./button.js";
import type { ResultCount } from "./list-result-header.js";

export interface SpamResultsOfferProps {
	/**
	 * How many matches the search found in Spam, as the server counted them —
	 * summed over every junk folder the search reached. `unknown` when any one of
	 * those folders went uncounted, and the offer then names no figure at all.
	 */
	count: ResultCount;
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
 * The count is the server's, over every junk folder the search reached; the
 * action opens one of them. It deliberately does not read "view them", because
 * scope is a single mailbox and a user with several accounts has several Spam
 * folders — the count would then name more mail than the click delivers. Saying
 * where the button goes is true whatever the account setup.
 *
 * `unknown` renders as no number rather than as a substitute for one. The
 * figure this used to show was the junk share of the page the client had
 * loaded, offered as a folder total; a match sitting below that page was
 * missing from it (#313). A count nobody could take is worth less than a wrong
 * one is harmful, so the offer stands without it and stays honest.
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
					{count.kind === "exact" ? (
						<>
							<span className="font-semibold text-fg tabular-nums">
								{count.value.toLocaleString()}
							</span>{" "}
							{`${plural(count.value)} from Spam`}
						</>
					) : (
						"Results from Spam"
					)}
				</p>
				<Button
					variant="ghost"
					size="sm"
					onClick={onScopeToSpam}
					className="shrink-0 text-accent"
				>
					Go to Spam
				</Button>
			</div>
		</Banner>
	);
}
