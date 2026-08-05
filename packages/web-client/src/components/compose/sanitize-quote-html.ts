import DOMPurify from "dompurify";

const QUOTE_ALLOWED_TAGS = [
	"p",
	"br",
	"strong",
	"b",
	"em",
	"i",
	"a",
	"blockquote",
	"ul",
	"ol",
	"li",
];

const QUOTE_ALLOWED_ATTR = ["href"];

/**
 * Quoted mail renders in the app's own document rather than in the reading
 * pane's sandboxed frame, so a link in it would otherwise navigate the app
 * window itself to wherever the sender points. Launched from a home screen
 * there is no address bar and no back button to return from that, so quoted
 * links leave for a separate context and take no handle on this one with them.
 *
 * Its own DOMPurify instance: the hook below must not reach the default
 * instance any other caller might use.
 */
let purifier: ReturnType<typeof DOMPurify> | null = null;

const quotePurifier = (): ReturnType<typeof DOMPurify> => {
	if (purifier) return purifier;
	const instance = DOMPurify();
	instance.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName !== "A") return;
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noopener noreferrer nofollow");
	});
	purifier = instance;
	return instance;
};

export const sanitizeQuoteHtml = (html: string): string =>
	quotePurifier().sanitize(html, {
		ALLOWED_TAGS: QUOTE_ALLOWED_TAGS,
		ALLOWED_ATTR: QUOTE_ALLOWED_ATTR,
	});
