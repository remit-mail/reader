/**
 * Pick the renderable body part from a `describeMessage` BodyPartResponse list
 * and fetch its content via CloudFront. The legacy inlined `bodyText` /
 * `bodyHtml` fields were removed in #224 PR 3 — body content lives at the
 * per-part `contentUrl`, JWT-authorized at the edge.
 *
 * Pure helpers (no React) so they can be unit-tested against the generated
 * type without standing up jsdom or DOMPurify.
 */

export type BodyContentKind = "html" | "text";

export interface RenderableBodyPart {
	mediaType: string;
	mediaSubtype: string;
	disposition?: string;
	contentUrl: string;
	isMultipart: boolean;
}

export interface PickedBodyPart {
	kind: BodyContentKind;
	contentUrl: string;
}

/**
 * Pick the best body part to render: prefer the first inline `text/html`,
 * fall back to the first inline `text/plain`. Multipart container rows and
 * attachment-disposition parts are ignored — they carry no renderable
 * payload at this position. Returns `null` when nothing renderable is
 * available so callers can show an empty-body affordance.
 */
export const pickRenderablePart = (
	parts: readonly RenderableBodyPart[],
): PickedBodyPart | null => {
	const renderable = parts.filter(
		(p) =>
			!p.isMultipart &&
			p.disposition !== "attachment" &&
			p.mediaType === "TEXT" &&
			p.contentUrl.length > 0,
	);
	const html = renderable.find((p) => p.mediaSubtype.toUpperCase() === "HTML");
	if (html) return { kind: "html", contentUrl: html.contentUrl };
	const text = renderable.find((p) => p.mediaSubtype.toUpperCase() === "PLAIN");
	if (text) return { kind: "text", contentUrl: text.contentUrl };
	return null;
};
