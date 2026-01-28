import DOMPurify from "dompurify";

export interface SanitizeOptions {
	allowExternalImages?: boolean;
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
				// Content-ID reference - will be resolved separately
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
			const style = node.getAttribute("style") || "";

			// Block url() references in CSS
			const sanitizedStyle = style
				.replace(/url\s*\([^)]*\)/gi, "none")
				.replace(/expression\s*\([^)]*\)/gi, "")
				.replace(/-moz-binding\s*:[^;]*/gi, "");

			if (sanitizedStyle !== style) {
				node.setAttribute("style", sanitizedStyle);
			}
		}
	});

	// Hook: Process style elements
	purify.addHook("uponSanitizeElement", (node, data) => {
		if (data.tagName === "style") {
			const css = node.textContent || "";

			// Remove @import rules and url() references
			const sanitizedCSS = css
				.replace(/@import[^;]*;/gi, "/* @import blocked */")
				.replace(/url\s*\([^)]*\)/gi, "none")
				.replace(/expression\s*\([^)]*\)/gi, "")
				.replace(/-moz-binding\s*:[^;]*/gi, "");

			node.textContent = sanitizedCSS;
		}
	});

	return (html: string): string => {
		return purify.sanitize(html, config);
	};
};

/**
 * Default sanitizer instance with external images blocked.
 */
export const sanitizeEmailHtml = createEmailSanitizer({
	allowExternalImages: false,
});
