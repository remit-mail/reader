/**
 * Resolver function for `cid:CONTENT_ID` references found in HTML bodies.
 * Returns the CloudFront URL (`BodyPartResponse.contentUrl`) for the part
 * with the matching `contentId`, or `undefined` when no matching part
 * exists — letting the broken-image render through is the intentional
 * fail-loud behaviour (#feedback_never_hide_failure).
 *
 * Lives in its own module so tests can import the pure function without
 * loading `email-sanitizer.ts`, which evaluates `DOMPurify()` at import
 * time and crashes outside a browser/JSDOM context.
 */
export type CidResolver = (contentId: string) => string | undefined;

export interface CidResolvableBodyPart {
	contentId?: string;
	contentUrl: string;
}

/**
 * Index a list of body parts by their (angle-bracket-stripped) `contentId`
 * and return a resolver. Calling the resolver with a `cid:` value's
 * Content-ID returns the corresponding `contentUrl`. Pure function — safe
 * to memoise on the body-parts reference.
 */
export const buildCidResolver = (
	bodyParts: readonly CidResolvableBodyPart[],
): CidResolver => {
	const byContentId = new Map<string, string>();
	for (const part of bodyParts) {
		if (!part.contentId || part.contentUrl.length === 0) continue;
		const stripped = part.contentId.replace(/^<|>$/g, "");
		byContentId.set(stripped, part.contentUrl);
	}
	return (contentId) => byContentId.get(contentId.replace(/^<|>$/g, ""));
};
