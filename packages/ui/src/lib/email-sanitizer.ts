import DOMPurify from "dompurify";
import type { CidResolver } from "./cid-resolver.js";
import { generateLayoutClampCSS } from "./email-layout-clamp.js";

export type { CidResolver } from "./cid-resolver.js";
export { buildCidResolver } from "./cid-resolver.js";
export { generateLayoutClampCSS } from "./email-layout-clamp.js";

export interface SanitizeOptions {
	allowExternalImages?: boolean;
	/**
	 * Resolve a `cid:CONTENT_ID` reference to a fetchable URL. The renderer
	 * looks up the body part with a matching `contentId` and returns its
	 * CloudFront `contentUrl` (#224 PR 2). When the resolver returns
	 * `undefined`, the original `cid:` URL is left in place so the failure
	 * is visible (broken image icon) — never silently substitute a blocked-
	 * placeholder, that would mask a real backend mismatch.
	 */
	resolveCid?: CidResolver;
}

/**
 * Output of the sanitize pipeline. `hasAuthorBackground` tells the renderer
 * whether the email author specified its own background — either via an
 * inline `style="background…"`, a legacy `bgcolor="…"` attribute, or inside
 * a `<style>` block. When true, the renderer pins the subtree to light-mode
 * so author colors survive (newsletter / designed mail). When false, the
 * subtree inherits the app theme so plain mail blends with dark chrome
 * instead of becoming a bright slab (#375).
 *
 * `hasAuthorSpacing` is the same question for layout: does the mail hold its own
 * content off its container's left and right edges? A newsletter that already
 * spaces its container must not be given a second helping; everything else —
 * including a personal reply whose only declarations are a quote's indent and
 * the gaps between paragraphs — gets breathing room injected inside its own
 * background.
 */
export interface SanitizedEmail {
	html: string;
	hasAuthorBackground: boolean;
	hasAuthorSpacing: boolean;
}

/**
 * CSS values that represent "no background" — finding `background[-color]:`
 * set to one of these in a `<style>` block does NOT constitute an author
 * background. Values are matched case-insensitively.
 */
const NO_BACKGROUND_VALUES = /^(none|transparent|inherit|initial|unset)\s*$/i;

/**
 * Extract all `<style>…</style>` block contents from the raw HTML string.
 */
const extractStyleBlocks = (html: string): string[] => {
	const blocks: string[] = [];
	const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
	let match: RegExpExecArray | null;
	match = re.exec(html);
	while (match !== null) {
		blocks.push(match[1]);
		match = re.exec(html);
	}
	return blocks;
};

/**
 * Return true if the CSS text contains a `background` or `background-color`
 * declaration with a value that is not one of the "no-op" keywords
 * (`none`, `transparent`, `inherit`, `initial`, `unset`). A light
 * declaration scan — no full CSS parser needed.
 *
 * Note: this intentionally matches any selector (including class selectors
 * like `.foo { background: red }`). Determining whether a given rule is
 * "applied" to any element requires DOM access and a full cascade, which is
 * beyond the scope of a pre-sanitization heuristic. The main fixes this
 * closes are reset stylesheets (`background: none / transparent`) and
 * `background: inherit` resets that were spuriously triggering the framed
 * treatment (#483). A class rule with a real color value is treated as an
 * author background on the conservative side.
 */
const styleBlockHasBackground = (css: string): boolean => {
	// Match `background:` or `background-color:` followed by its value
	// (everything up to the next `;`, `}`, or end of string).
	const re = /background(?:-color)?\s*:\s*([^;}\n]+)/gi;
	let match: RegExpExecArray | null;
	match = re.exec(css);
	while (match !== null) {
		const value = match[1].trim();
		if (!NO_BACKGROUND_VALUES.test(value)) {
			return true;
		}
		match = re.exec(css);
	}
	return false;
};

/**
 * Detect whether the input HTML contains an author-specified background.
 * Runs over the raw HTML string before sanitization — a real CSS parser is
 * overkill here because the false-positive surface is "the literal word
 * 'background' inside a `<style>` block or a `style=` attribute", and that's
 * exactly the content we'd parse anyway. Match on:
 *   - any `style="…background…"` (or `style='…'`)
 *   - any `bgcolor=` attribute
 *   - any `<style>` block that contains a `background[-color]:` declaration
 *     with a non-trivial value (not `none`, `transparent`, `inherit`,
 *     `initial`, or `unset`) — tightened from the bare substring match that
 *     was over-matching reset stylesheets and `background: none` rules (#483)
 *
 * Author *text* colour alone (no background) does not trigger — that's the
 * point: a plain `<p style="color:#666">…</p>` mail still blends with the
 * app theme.
 */
export const detectAuthorBackground = (html: string): boolean => {
	if (/\bstyle\s*=\s*["'][^"']*background/i.test(html)) return true;
	if (/\bbgcolor\s*=/i.test(html)) return true;
	for (const block of extractStyleBlocks(html)) {
		if (styleBlockHasBackground(block)) return true;
	}
	return false;
};

/**
 * CSS keywords that space nothing: a `margin: 0` reset is not the mail laying
 * out its own breathing room, and neither is `margin: auto` centring a table.
 */
const NO_SPACING_KEYWORDS = new Set([
	"auto",
	"none",
	"initial",
	"inherit",
	"unset",
	"revert",
	"revert-layer",
]);

/**
 * `padding` / `margin` declarations, and only those. The lookbehind keeps the
 * properties that merely end in the same word out of the scan — `scroll-padding`
 * on a scroll container and Outlook's `mso-padding-alt` are not the mail
 * spacing its container.
 */
const SPACING_DECL_RE =
	/(?<![-\w])(?:padding|margin)(?:-(top|right|bottom|left|block|inline)(?:-(?:start|end))?)?\s*:\s*([^;}"']+)/gi;

const VERTICAL_SIDES = new Set(["top", "bottom", "block"]);

/** CSS comments hold no declarations, in a `<style>` block or in a `style=`. */
const stripCssComments = (css: string): string =>
	css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Whether one length token pushes content off the container edge. Zero, a
 * keyword and a negative all fail — a negative margin pulls content out rather
 * than spacing it in. Anything unrecognised (`calc()`, `var()`) counts, on the
 * conservative side of leaving a self-spacing mail alone.
 */
const isSpacingLength = (token: string): boolean => {
	const value = token.toLowerCase();
	if (!value || NO_SPACING_KEYWORDS.has(value)) return false;
	if (value.startsWith("-")) return false;
	const numeric = /^\+?(\d*\.?\d+)[a-z%]*$/.exec(value);
	if (numeric) return Number.parseFloat(numeric[1]) !== 0;
	return true;
};

/** The left/right components of a `padding`/`margin` shorthand value. */
const horizontalComponents = (value: string): string[] => {
	const parts = value.split(/\s+/).filter(Boolean);
	if (parts.length < 2) return parts;
	if (parts.length < 4) return [parts[1]];
	return [parts[1], parts[3]];
};

/**
 * Whether one declaration spaces the container horizontally. Only the
 * horizontal axis answers the question the inset asks: a `margin-bottom` between
 * two Outlook paragraphs is the mail spacing its own paragraphs, not laying out
 * a container, and a mail with nothing but that still runs into a phone's screen
 * edge without the inset.
 */
const spacesHorizontally = (side: string | undefined, raw: string): boolean => {
	if (side && VERTICAL_SIDES.has(side)) return false;
	const value = raw.replace(/!\s*important/gi, "").trim();
	if (!value) return false;
	if (side) return value.split(/\s+/).some(isSpacingLength);
	return horizontalComponents(value).some(isSpacingLength);
};

/** Whether CSS text lays out horizontal container spacing. */
const declaresContainerSpacing = (css: string): boolean => {
	for (const match of stripCssComments(css).matchAll(SPACING_DECL_RE)) {
		if (spacesHorizontally(match[1], match[2])) return true;
	}
	return false;
};

/**
 * Elements whose spacing is a convention rather than a container. Every mail
 * client on earth indents a quote with a left margin on the `<blockquote>`, and
 * a reply carrying a quote is exactly the mail the injected inset exists for.
 */
const SPACING_EXEMPT_TAGS = new Set(["blockquote"]);

/** HTML comments hold no markup — including the `<!--[if mso]>` conditionals
 *  Outlook mail is padded with, which no other client ever renders. */
const stripHtmlComments = (html: string): string =>
	html.replace(/<!--[\s\S]*?-->/g, "");

/**
 * Every inline `style="…"` / `style='…'` value in the raw markup, with the tag
 * carrying it. Scanning tags rather than the whole string is what keeps a
 * literal `style="padding:9px"` written out in the text of a mail ABOUT CSS
 * from reading as layout.
 */
const extractStyledTags = (html: string): { tag: string; style: string }[] => {
	const found: { tag: string; style: string }[] = [];
	const tags = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
	const styles = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	for (const [, tag, attrs] of html.matchAll(tags)) {
		for (const match of attrs.matchAll(styles)) {
			found.push({ tag: tag.toLowerCase(), style: match[1] ?? match[2] ?? "" });
		}
	}
	return found;
};

/** `selector { … }` pairs; a nested at-rule yields its inner rules. */
const extractCssRules = (css: string): { selector: string; body: string }[] =>
	[...stripCssComments(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((match) => ({
		selector: match[1].trim(),
		body: match[2],
	}));

/** The element a selector actually styles — the tag of its last compound. */
const selectorSubjectTag = (selector: string): string => {
	const last =
		selector
			.trim()
			.split(/[\s>+~]+/)
			.pop() ?? "";
	return (/^[a-zA-Z][\w-]*/.exec(last)?.[0] ?? "").toLowerCase();
};

const stylesOnlyQuotes = (selector: string): boolean =>
	selector
		.split(",")
		.every((one) => SPACING_EXEMPT_TAGS.has(selectorSubjectTag(one)));

/**
 * Detect whether the mail lays out horizontal spacing of its own — in an inline
 * style, in a `<style>` block, or through a non-zero `cellpadding` on the tables
 * newsletters are still built from. Same shape and same limits as
 * `detectAuthorBackground`: a declaration scan over the raw markup, deliberately
 * conservative, because the cost of a false positive (no injected inset) is a
 * message that runs into the screen edge, while a false negative doubles a
 * newsletter's own padding.
 */
export const detectAuthorSpacing = (html: string): boolean => {
	// Style blocks come off the raw string: old mail wraps its CSS in an HTML
	// comment to hide it from clients that never shipped `<style>`.
	const blocks = extractStyleBlocks(html);
	const markup = stripHtmlComments(html);
	if (/\bcellpadding\s*=\s*["']?(?!0["'\s>])\d/i.test(markup)) return true;
	for (const { tag, style } of extractStyledTags(markup)) {
		if (SPACING_EXEMPT_TAGS.has(tag)) continue;
		if (declaresContainerSpacing(style)) return true;
	}
	for (const block of blocks) {
		for (const rule of extractCssRules(block)) {
			if (stylesOnlyQuotes(rule.selector)) continue;
			if (declaresContainerSpacing(rule.body)) return true;
		}
	}
	return false;
};

const FORBIDDEN_TAGS = [
	"script",
	"iframe",
	"object",
	"embed",
	"form",
	"input",
	"button",
	"textarea",
	"select",
	"meta",
	"link",
	"base",
];

const FORBIDDEN_ATTR = [
	// Event handlers
	"onerror",
	"onload",
	"onclick",
	"onmouseover",
	"onmouseout",
	"onfocus",
	"onblur",
	"onsubmit",
	"onkeydown",
	"onkeyup",
	// Dangerous attributes
	"formaction",
	"xlink:href",
	"data-bind",
];

// Placeholder for blocked images
const PLACEHOLDER_IMAGE =
	"data:image/svg+xml," +
	encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <rect fill="#f0f0f0" width="100" height="100"/>
    <text x="50" y="50" text-anchor="middle" dy=".3em" fill="#999" font-size="12">
      Image blocked
    </text>
  </svg>
`);

/**
 * Strip CSS constructs that double as injection vectors from an inline
 * `style="..."` value:
 *   - `url(...)` — author can reference remote backgrounds, which leaks the
 *     read event the same way an `<img>` would. Privacy.
 *   - `expression(...)` — legacy IE CSS-as-JS escape hatch. XSS.
 *   - `-moz-binding: ...` — legacy Firefox CSS-to-XBL escape hatch. XSS.
 *
 * Author colors/backgrounds pass through unchanged — the email body is
 * rendered as a light-mode island (see `IsolatedEmailFrame`'s
 * `color-scheme: light`), so author CSS can stand on its own.
 */
export const sanitizeInlineStyle = (style: string): string => {
	return style
		.replace(/url\s*\([^)]*\)/gi, "none")
		.replace(/expression\s*\([^)]*\)/gi, "")
		.replace(/-moz-binding\s*:[^;]*/gi, "");
};

/**
 * Same security scrub as `sanitizeInlineStyle`, plus `@import` neutering for
 * `<style>` block contents — `@import` can pull in remote stylesheets and
 * leaks the read event.
 *
 * Crucially, this does NOT wrap the author's CSS in a media query: the email
 * subtree is pinned to light-mode at the wrapper level, so author CSS that
 * targets `body { background: white; color: black; }` keeps applying.
 */
export const sanitizeStyleElementCss = (css: string): string => {
	return css
		.replace(/@import[^;]*;/gi, "/* @import blocked */")
		.replace(/url\s*\([^)]*\)/gi, "none")
		.replace(/expression\s*\([^)]*\)/gi, "")
		.replace(/-moz-binding\s*:[^;]*/gi, "");
};

// ============================================
// Main Sanitizer
// ============================================

export const createEmailSanitizer = (options: SanitizeOptions = {}) => {
	const purify = DOMPurify();

	const config = {
		FORBID_TAGS: FORBIDDEN_TAGS,
		FORBID_ATTR: FORBIDDEN_ATTR,
		ALLOW_DATA_ATTR: false,
		ALLOW_UNKNOWN_PROTOCOLS: false,
	};

	// Hook: Process elements after attribute sanitization
	purify.addHook("afterSanitizeAttributes", (node) => {
		// Handle images
		if (node.tagName === "IMG") {
			const src = node.getAttribute("src") || "";

			if (src.startsWith("data:")) {
				// Allow data URIs (inline images)
				return;
			}

			if (src.startsWith("cid:")) {
				// `cid:` references inline body parts. Look up the matching
				// body part by Content-ID and rewrite to the CloudFront
				// `contentUrl` (#224 PR 2). The Content-ID in the URL may
				// or may not be wrapped in angle brackets — strip them so
				// the comparison is consistent across mail clients.
				const raw = src.slice(4);
				const stripped = raw.replace(/^<|>$/g, "");
				const resolved = options.resolveCid?.(stripped);
				if (resolved) {
					node.setAttribute("src", resolved);
					node.classList.add("inline-content");
				}
				return;
			}

			if (!options.allowExternalImages) {
				// Store original src for "load images" feature
				node.setAttribute("data-blocked-src", src);
				node.setAttribute("src", PLACEHOLDER_IMAGE);
				node.setAttribute("alt", "[Blocked image]");
				node.classList.add("blocked-image");
			}
		}

		// Handle links
		if (node.tagName === "A") {
			const href = node.getAttribute("href") || "";

			// Block javascript: and data: URLs
			if (/^(javascript|data):/i.test(href)) {
				node.removeAttribute("href");
				return;
			}

			// Make external links safe
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noopener noreferrer nofollow");

			// Add visual indicator for external links
			node.classList.add("external-link");
		}

		// Sanitize inline styles — security only, colors pass through.
		if (node.hasAttribute("style")) {
			const style = node.getAttribute("style") || "";
			node.setAttribute("style", sanitizeInlineStyle(style));
		}
	});

	// Hook: Process style elements
	purify.addHook("uponSanitizeElement", (node, data) => {
		if (data.tagName === "style") {
			const css = node.textContent || "";
			node.textContent = sanitizeStyleElementCss(css);
		}
	});

	return (html: string): SanitizedEmail => {
		// Detect BEFORE sanitization: DOMPurify keeps `style=` / `bgcolor=` /
		// author `<style>` content for us (we deliberately preserve them in
		// #375), but running the detector on the raw input is simpler and
		// not sensitive to any future hook rewrites.
		const hasAuthorBackground = detectAuthorBackground(html);
		const hasAuthorSpacing = detectAuthorSpacing(html);

		const sanitized = purify.sanitize(html, config);

		// Layout clamp always applies — it keeps wide author markup (fixed-width
		// tables, oversized images, long URLs) from breaking out of the column
		// and unlocking horizontal page scroll on mobile (#374). Independent of
		// any color concerns because it touches layout only.
		const layoutCss = generateLayoutClampCSS();
		return {
			html: `<style>${layoutCss}</style>${sanitized}`,
			hasAuthorBackground,
			hasAuthorSpacing,
		};
	};
};
