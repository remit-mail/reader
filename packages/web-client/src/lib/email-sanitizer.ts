import DOMPurify from "dompurify";
import type { CidResolver } from "./cid-resolver";

export type ColorMode = "light" | "dark" | "auto";
export type { CidResolver } from "./cid-resolver";
export { buildCidResolver } from "./cid-resolver";

export interface SanitizeOptions {
	allowExternalImages?: boolean;
	/**
	 * Allow the email author's own background colors and `bgcolor`
	 * attributes through unchanged. Emails often paint full-bleed
	 * branded backgrounds (e.g. bol.com) that are unreadable when our
	 * dark-mode overrides repaint them; once the user has trusted the
	 * sender (e.g. by loading remote images) we should respect their
	 * design. Defaults to `false` to avoid the "disco" effect on
	 * untrusted mail.
	 * @default false
	 */
	allowAuthorBackgrounds?: boolean;
	/**
	 * Color mode for email content adaptation.
	 * - 'light': No color processing (email designed for light backgrounds)
	 * - 'dark': Process colors to work on dark backgrounds
	 * - 'auto': Use prefers-color-scheme media query (wraps styles)
	 * @default 'auto'
	 */
	colorMode?: ColorMode;
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

// ============================================
// Color Processing Utilities
// ============================================

interface RGB {
	r: number;
	g: number;
	b: number;
	a?: number;
}

/**
 * Parse a color string into RGB values.
 * Supports: #rgb, #rrggbb, rgb(), rgba(), named colors (white, black)
 */
const parseColor = (color: string): RGB | null => {
	const trimmed = color.trim().toLowerCase();

	// Named colors we care about
	const namedColors: Record<string, RGB> = {
		white: { r: 255, g: 255, b: 255 },
		black: { r: 0, g: 0, b: 0 },
		transparent: { r: 0, g: 0, b: 0, a: 0 },
	};

	if (namedColors[trimmed]) {
		return namedColors[trimmed];
	}

	// Hex colors
	const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/);
	if (hexMatch) {
		const hex = hexMatch[1];
		if (hex.length === 3) {
			return {
				r: Number.parseInt(hex[0] + hex[0], 16),
				g: Number.parseInt(hex[1] + hex[1], 16),
				b: Number.parseInt(hex[2] + hex[2], 16),
			};
		}
		if (hex.length === 6) {
			return {
				r: Number.parseInt(hex.slice(0, 2), 16),
				g: Number.parseInt(hex.slice(2, 4), 16),
				b: Number.parseInt(hex.slice(4, 6), 16),
			};
		}
		if (hex.length === 8) {
			return {
				r: Number.parseInt(hex.slice(0, 2), 16),
				g: Number.parseInt(hex.slice(2, 4), 16),
				b: Number.parseInt(hex.slice(4, 6), 16),
				a: Number.parseInt(hex.slice(6, 8), 16) / 255,
			};
		}
	}

	// rgb() and rgba()
	const rgbMatch = trimmed.match(
		/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/,
	);
	if (rgbMatch) {
		return {
			r: Number.parseInt(rgbMatch[1], 10),
			g: Number.parseInt(rgbMatch[2], 10),
			b: Number.parseInt(rgbMatch[3], 10),
			a: rgbMatch[4] ? Number.parseFloat(rgbMatch[4]) : undefined,
		};
	}

	return null;
};

/**
 * Calculate relative luminance (0-1) for a color.
 * Used to determine if a color is "light" or "dark".
 */
const getLuminance = (rgb: RGB): number => {
	const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

/**
 * Check if a color is "light" (good for light mode background).
 * Threshold: luminance > 0.85 (very light colors like white, near-white)
 */
const isLightColor = (rgb: RGB): boolean => {
	return getLuminance(rgb) > 0.85;
};

/**
 * Check if a color is "dark" (good for light mode text).
 * Threshold: luminance < 0.15 (very dark colors like black, near-black)
 */
const isDarkColor = (rgb: RGB): boolean => {
	return getLuminance(rgb) < 0.15;
};

/**
 * Check if a color has low alpha (semi-transparent).
 */
const hasLowAlpha = (rgb: RGB): boolean => {
	return rgb.a !== undefined && rgb.a < 0.5;
};

// Color property patterns in CSS
const BACKGROUND_PROPS =
	/\b(background|background-color)\s*:\s*([^;!]+)(?:!important)?/gi;
const COLOR_PROPS = /\bcolor\s*:\s*([^;!]+)(?:!important)?/gi;
const BORDER_COLOR_PROPS =
	/\b(border(?:-[a-z]+)?-color|border(?:-[a-z]+)?)\s*:\s*([^;!]+)(?:!important)?/gi;

/**
 * Process inline style for dark mode compatibility.
 * Replaces problematic light-mode colors with inherit/transparent.
 */
const processStyleForDarkMode = (style: string): string => {
	let processed = style;

	// Process background colors
	processed = processed.replace(BACKGROUND_PROPS, (match, prop, value) => {
		const color = parseColor(value);
		if (color && (isLightColor(color) || hasLowAlpha(color))) {
			return `${prop}: transparent`;
		}
		return match;
	});

	// Process text colors
	processed = processed.replace(COLOR_PROPS, (match, value) => {
		const color = parseColor(value);
		if (color && isDarkColor(color)) {
			return "color: inherit";
		}
		return match;
	});

	// Process border colors (optional - can be aggressive)
	processed = processed.replace(BORDER_COLOR_PROPS, (match, prop, value) => {
		const color = parseColor(value);
		if (color && (isLightColor(color) || isDarkColor(color))) {
			return `${prop}: currentColor`;
		}
		return match;
	});

	return processed;
};

/**
 * Generate dark mode override CSS.
 * Uses attribute selectors and broad rules to adapt emails for dark backgrounds.
 */
const generateDarkModeOverrideCSS = (): string => `
/* Dark mode overrides for email content - scoped to .email-content */
@media (prefers-color-scheme: dark) {
  /* ========================================
   * TEXT COLORS - Force light text
   * ======================================== */

  /* Black text -> bright light */
  .email-content [style*="color: black"],
  .email-content [style*="color:black"],
  .email-content [style*="color:#000"],
  .email-content [style*="color: #000"],
  .email-content [style*="color: rgb(0"],
  .email-content [style*="color:rgb(0"] {
    color: #f1f5f9 !important;
  }

  /* Very dark text (#1, #2) -> bright */
  .email-content [style*="color:#1"],
  .email-content [style*="color: #1"],
  .email-content [style*="color:#2"],
  .email-content [style*="color: #2"] {
    color: #f1f5f9 !important;
  }

  /* Dark gray text (#3, #4, #5) -> light */
  .email-content [style*="color:#3"],
  .email-content [style*="color: #3"],
  .email-content [style*="color:#4"],
  .email-content [style*="color: #4"],
  .email-content [style*="color:#5"],
  .email-content [style*="color: #5"] {
    color: #e2e8f0 !important;
  }

  /* Medium gray text (#6, #7, #8) -> lighter */
  .email-content [style*="color:#6"],
  .email-content [style*="color: #6"],
  .email-content [style*="color:#7"],
  .email-content [style*="color: #7"],
  .email-content [style*="color:#8"],
  .email-content [style*="color: #8"] {
    color: #cbd5e1 !important;
  }

  /* RGB dark colors (0-50) -> bright */
  .email-content [style*="color: rgb(0"],
  .email-content [style*="color:rgb(0"],
  .email-content [style*="color: rgb(1"],
  .email-content [style*="color:rgb(1"],
  .email-content [style*="color: rgb(2"],
  .email-content [style*="color:rgb(2"],
  .email-content [style*="color: rgb(3"],
  .email-content [style*="color:rgb(3"],
  .email-content [style*="color: rgb(4"],
  .email-content [style*="color:rgb(4"],
  .email-content [style*="color: rgb(5"],
  .email-content [style*="color:rgb(5"] {
    color: #f1f5f9 !important;
  }

  /* RGB medium-dark colors (60-120) -> light */
  .email-content [style*="color: rgb(6"],
  .email-content [style*="color:rgb(6"],
  .email-content [style*="color: rgb(7"],
  .email-content [style*="color:rgb(7"],
  .email-content [style*="color: rgb(8"],
  .email-content [style*="color:rgb(8"],
  .email-content [style*="color: rgb(9"],
  .email-content [style*="color:rgb(9"],
  .email-content [style*="color: rgb(10"],
  .email-content [style*="color:rgb(10"],
  .email-content [style*="color: rgb(11"],
  .email-content [style*="color:rgb(11"],
  .email-content [style*="color: rgb(12"],
  .email-content [style*="color:rgb(12"] {
    color: #e2e8f0 !important;
  }

  /* ========================================
   * BACKGROUNDS - Invert light to dark
   * ======================================== */

  /* White/near-white backgrounds -> dark */
  .email-content [style*="background: white"],
  .email-content [style*="background:white"],
  .email-content [style*="background-color: white"],
  .email-content [style*="background-color:white"],
  .email-content [style*="background:#fff"],
  .email-content [style*="background: #fff"],
  .email-content [style*="background-color:#fff"],
  .email-content [style*="background-color: #fff"],
  .email-content [style*="background:#ffffff"],
  .email-content [style*="background: #ffffff"],
  .email-content [style*="background-color:#ffffff"],
  .email-content [style*="background-color: #ffffff"],
  .email-content [style*="background:#FFFFFF"],
  .email-content [style*="background-color:#FFFFFF"],
  .email-content [style*="background: rgb(255"],
  .email-content [style*="background:rgb(255"],
  .email-content [style*="background-color: rgb(255"],
  .email-content [style*="background-color:rgb(255"],
  .email-content [style*="background: rgb(25"],
  .email-content [style*="background:rgb(25"],
  .email-content [style*="background-color: rgb(25"],
  .email-content [style*="background-color:rgb(25"],
  .email-content [style*="background: rgb(24"],
  .email-content [style*="background:rgb(24"],
  .email-content [style*="background-color: rgb(24"],
  .email-content [style*="background-color:rgb(24"] {
    background-color: #1e293b !important;
  }

  /* Light gray backgrounds (#f, #e, #d, #c, #b, #a, #9) -> dark gray */
  .email-content [style*="background:#f"],
  .email-content [style*="background: #f"],
  .email-content [style*="background-color:#f"],
  .email-content [style*="background-color: #f"],
  .email-content [style*="background:#e"],
  .email-content [style*="background: #e"],
  .email-content [style*="background-color:#e"],
  .email-content [style*="background-color: #e"],
  .email-content [style*="background:#d"],
  .email-content [style*="background: #d"],
  .email-content [style*="background-color:#d"],
  .email-content [style*="background-color: #d"],
  .email-content [style*="background:#c"],
  .email-content [style*="background: #c"],
  .email-content [style*="background-color:#c"],
  .email-content [style*="background-color: #c"],
  .email-content [style*="background:#b"],
  .email-content [style*="background: #b"],
  .email-content [style*="background-color:#b"],
  .email-content [style*="background-color: #b"],
  .email-content [style*="background:#a"],
  .email-content [style*="background: #a"],
  .email-content [style*="background-color:#a"],
  .email-content [style*="background-color: #a"],
  .email-content [style*="background:#9"],
  .email-content [style*="background: #9"],
  .email-content [style*="background-color:#9"],
  .email-content [style*="background-color: #9"] {
    background-color: #334155 !important;
  }

  /* RGB light backgrounds (200+) -> dark */
  .email-content [style*="background: rgb(2"],
  .email-content [style*="background:rgb(2"],
  .email-content [style*="background-color: rgb(2"],
  .email-content [style*="background-color:rgb(2"] {
    background-color: #334155 !important;
  }

  /* Legacy bgcolor attribute */
  .email-content [bgcolor="white"],
  .email-content [bgcolor="#fff"],
  .email-content [bgcolor="#ffffff"],
  .email-content [bgcolor="#FFFFFF"] {
    background-color: #1e293b !important;
  }

  /* Other bgcolor values - make transparent */
  .email-content [bgcolor] {
    background-color: transparent !important;
  }

  /* ========================================
   * BORDERS - Adjust for visibility
   * ======================================== */

  /* Light borders -> darker */
  .email-content [style*="border"][style*="#f"],
  .email-content [style*="border"][style*="#e"],
  .email-content [style*="border"][style*="#d"],
  .email-content [style*="border"][style*="#c"],
  .email-content [style*="border"][style*="#b"],
  .email-content [style*="border"][style*="#a"],
  .email-content [style*="border"][style*="#9"],
  .email-content [style*="border"][style*="white"],
  .email-content [style*="border"][style*="rgb(2"] {
    border-color: #475569 !important;
  }

  /* ========================================
   * COMMON ELEMENTS - Safe defaults
   * ======================================== */

  /* Links should stay visible - override any inline color on link or its children */
  .email-content a,
  .email-content a *,
  .email-content a[style],
  .email-content a[style*="color"],
  .email-content a *[style*="color"] {
    color: #60a5fa !important;
  }

  .email-content a:visited,
  .email-content a:visited * {
    color: #a78bfa !important;
  }
}
`;

/**
 * Process CSS block for dark mode.
 * Wraps original styles in light-mode media query.
 */
const processCssForDarkMode = (css: string): string => {
	// Wrap original CSS in light-mode media query
	return `
/* Original email styles (light mode only) */
@media (prefers-color-scheme: light) {
${css}
}
`;
};

// ============================================
// Main Sanitizer
// ============================================

export const createEmailSanitizer = (options: SanitizeOptions = {}) => {
	const purify = DOMPurify();
	const colorMode = options.colorMode ?? "auto";

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

		// Sanitize inline styles
		if (node.hasAttribute("style")) {
			let style = node.getAttribute("style") || "";

			// Block url() references in CSS
			style = style
				.replace(/url\s*\([^)]*\)/gi, "none")
				.replace(/expression\s*\([^)]*\)/gi, "")
				.replace(/-moz-binding\s*:[^;]*/gi, "");

			// Process colors for dark mode (direct transformation)
			// This handles rgb() values that CSS attribute selectors can't easily match
			if (colorMode === "dark") {
				style = processStyleForDarkMode(style);
			}

			node.setAttribute("style", style);
		}

		// Handle bgcolor attribute (legacy HTML). Skip when the caller has
		// trusted the author's backgrounds (e.g. images loaded).
		if (
			!options.allowAuthorBackgrounds &&
			(colorMode === "dark" || colorMode === "auto") &&
			node.hasAttribute("bgcolor")
		) {
			const bgcolor = node.getAttribute("bgcolor") || "";
			const color = parseColor(bgcolor);
			if (color && isLightColor(color)) {
				node.removeAttribute("bgcolor");
			}
		}
	});

	// Hook: Process style elements
	purify.addHook("uponSanitizeElement", (node, data) => {
		if (data.tagName === "style") {
			let css = node.textContent || "";

			// Remove @import rules and url() references
			css = css
				.replace(/@import[^;]*;/gi, "/* @import blocked */")
				.replace(/url\s*\([^)]*\)/gi, "none")
				.replace(/expression\s*\([^)]*\)/gi, "")
				.replace(/-moz-binding\s*:[^;]*/gi, "");

			// Process for dark mode
			if (colorMode === "dark" || colorMode === "auto") {
				css = processCssForDarkMode(css);
			}

			node.textContent = css;
		}
	});

	return (html: string): string => {
		const sanitized = purify.sanitize(html, config);

		// Inject dark mode override styles for auto/dark modes
		if (colorMode === "auto" || colorMode === "dark") {
			const darkModeCSS = generateDarkModeOverrideCSS();
			return `<style>${darkModeCSS}</style>${sanitized}`;
		}

		return sanitized;
	};
};

/**
 * Default sanitizer instance with external images blocked.
 */
export const sanitizeEmailHtml = createEmailSanitizer({
	allowExternalImages: false,
	colorMode: "auto",
});
