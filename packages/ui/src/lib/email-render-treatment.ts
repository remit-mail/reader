/**
 * Render-treatment classification for an email body (#424).
 *
 * Two visual treatments exist in the reading pane:
 *
 *  - `framed`: designed HTML mail (newsletter / marketing category, OR an
 *    author-specified background detected by the sanitizer). Rendered inside a
 *    left-anchored hairline frame pinned to light-mode so the author's own
 *    colors survive dark mode and are never inverted.
 *
 *  - plain (`isPlain`): weakly-marked / personal mail with no author
 *    background. Receives the UI sans-serif + theme-aware base CSS so
 *    black-text-on-dark is readable.
 *
 * This is the single source of truth for the branch; `MessageBodyView` consumes
 * it so the decision is unit-testable in isolation (no DOM, no iframe).
 */

/**
 * Subset of RemitImapMessageCategory used by the renderer. Kept local to avoid
 * a hard dependency on the generated types (this file compiles before `make`
 * in fresh checkouts).
 */
export type EmailRenderCategory =
	| "uncategorized"
	| "personal"
	| "newsletter"
	| "marketing"
	| "automated"
	| "transactional"
	| "social";

export interface EmailRenderTreatment {
	/** Designed mail: render framed + light-mode, preserve author colors. */
	framed: boolean;
	/** Plain mail: inject UI font-stack + theme-aware colors. */
	isPlain: boolean;
}

/**
 * Classify an email into the framed (designed) vs plain treatment.
 *
 * `framed` when the category is `newsletter`/`marketing` OR the sanitizer
 * detected an author background. `isPlain` is the complement.
 */
export const classifyEmailRenderTreatment = (
	category: EmailRenderCategory | undefined,
	hasAuthorBackground: boolean,
): EmailRenderTreatment => {
	const isDesignedCategory =
		category === "newsletter" || category === "marketing";
	const framed = isDesignedCategory || hasAuthorBackground;
	return { framed, isPlain: !framed };
};
