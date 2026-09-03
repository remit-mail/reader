/**
 * What the composer knows about the original a reply or a forward carries.
 *
 * - `absent` — nothing to carry: a new message, or a draft read back with the
 *   quote already in its body.
 * - `pending` — the original has not arrived. Send waits for it.
 * - `failed` — the fetch failed. Send goes without it, having said so.
 * - `unquotable` — the original arrived and holds no text to quote.
 * - `ready` — the quoted block is assembled and will leave with the send.
 */
export type QuoteReadiness =
	| "absent"
	| "pending"
	| "failed"
	| "unquotable"
	| "ready";

export interface QuoteReadinessInput {
	isQuoting: boolean;
	/** A resumed draft was saved with the quote in it; there is none to fetch. */
	documentHoldsQuote: boolean;
	/** The describe read for the source message has landed. */
	sourceResolved: boolean;
	/** The source declared a text or html part to quote from. */
	hasRenderablePart: boolean;
	/** That part's content has been fetched. */
	hasBody: boolean;
	isError: boolean;
}

/**
 * `pending` and `unquotable` are separate answers to two questions that look
 * alike from `useMessageBodyContent` alone: the body query is disabled both
 * while the source is still arriving and once it has arrived declaring no
 * renderable part, so `isLoading` is false in each. Read as one state they
 * either dead-lock Send on a message that will never have a body, or let a
 * source that has none leave silently — which is the defect (#1030).
 *
 * A source that never resolves is `pending` forever, and that is correct: the
 * describe read carries no `meta.softError`, so a failure of it escalates to
 * the app's error overlay rather than sitting under a live composer.
 */
export const quoteReadiness = ({
	isQuoting,
	documentHoldsQuote,
	sourceResolved,
	hasRenderablePart,
	hasBody,
	isError,
}: QuoteReadinessInput): QuoteReadiness => {
	if (!isQuoting || documentHoldsQuote) return "absent";
	if (!sourceResolved) return "pending";
	if (isError) return "failed";
	if (!hasRenderablePart) return "unquotable";
	if (!hasBody) return "pending";
	return "ready";
};
