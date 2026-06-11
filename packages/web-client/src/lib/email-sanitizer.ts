import DOMPurify from "dompurify";
import type { CidResolver } from "./cid-resolver";
import { generateLayoutClampCSS } from "./email-layout-clamp";

export type { CidResolver } from "./cid-resolver";
export { buildCidResolver } from "./cid-resolver";
export { generateLayoutClampCSS } from "./email-layout-clamp";

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
 */
export interface SanitizedEmail {
	html: string;
	hasAuthorBackground: boolean;
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
	while ((match = re.exec(html)) !== null) {
		blocks.push(match[1]);
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
	while ((match = re.exec(css)) !== null) {
		const value = match[1].trim();
		if (!NO_BACKGROUND_VALUES.test(value)) {
			return true;
		}
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
 * rendered as a light-mode island (see `MessageBody.tsx`'s
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

		const sanitized = purify.sanitize(html, config);

		// Layout clamp always applies — it keeps wide author markup (fixed-width
		// tables, oversized images, long URLs) from breaking out of the column
		// and unlocking horizontal page scroll on mobile (#374). Independent of
		// any color concerns because it touches layout only.
		const layoutCss = generateLayoutClampCSS();
		return {
			html: `<style>${layoutCss}</style>${sanitized}`,
			hasAuthorBackground,
		};
	};
};
