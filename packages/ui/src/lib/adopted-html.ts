import DOMPurify from "dompurify";

/**
 * Adopted content is HTML from outside — a paste, a quoted reply — that becomes
 * part of a message this app sends under the user's name. That is the opposite
 * case from `createEmailSanitizer`, which renders untrusted mail inside a
 * sandboxed frame and keeps author `style`, `bgcolor` and `<style>` so a
 * newsletter still looks like itself. Output this app signs has to survive the
 * sanitizer of every receiving client, so it keeps structure and drops
 * presentation.
 */
const ADOPTED_TAGS = [
	"p",
	"br",
	// A web page and a Gmail clipboard put each line in its own `div`. Unwrapped,
	// those lines arrive as one run of adjacent text and the editor merges them
	// into a single paragraph; kept, Lexical's HTML import reads each one as its
	// own block.
	"div",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"ul",
	"ol",
	"li",
	"blockquote",
	"pre",
	"code",
	"hr",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"a",
	"img",
];

// `lang` and `dir` are structure, not presentation: they are what a recipient's
// client and every screen reader read the language and the writing direction
// off, and they are what keeps a quoted passage in another language marked as
// one inside a message written in this one (#686).
const ADOPTED_ATTR = [
	"href",
	"src",
	"alt",
	"colspan",
	"rowspan",
	"lang",
	"dir",
];

const LINK_SCHEMES = /^(?:https?:|mailto:)/i;
const IMAGE_SCHEMES = /^(?:https:|data:image\/)/i;

/**
 * A pasted screenshot is as wide as the screen it came off, and the class the
 * editor draws it with is this app's own presentation — it does not leave with
 * the message. So the one constraint that has to survive is written here, on
 * the way out, rather than admitted from whoever wrote the source: `style`
 * stays out of ADOPTED_ATTR, and an image carries this declaration and no
 * other. Whether a `data:` image reaches a given client at all is a separate
 * question (#679).
 */
const IMAGE_SIZE = "max-width:100%;height:auto";

/**
 * `"quoted"` is mail rendered back at its sender, and it renders in the app's
 * own document rather than in the reading pane's sandboxed frame. A link in it
 * would otherwise navigate the app window itself to wherever the sender points,
 * and launched from a home screen there is no address bar and no back button to
 * return from that — so quoted links leave for a separate context and take no
 * handle on this one with them. Images are dropped outright there: the frame's
 * remote-content gate does not cover this document, and loading one tells the
 * sender when the reply was opened.
 */
type Profile = "outgoing" | "quoted";

const createPurifier = (profile: Profile): ReturnType<typeof DOMPurify> => {
	const instance = DOMPurify();
	if (!instance.isSupported) {
		throw new Error("adopted HTML cannot be sanitized: no DOM is available");
	}
	instance.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A") {
			if (!LINK_SCHEMES.test(node.getAttribute("href") ?? "")) {
				node.removeAttribute("href");
			}
			if (profile === "quoted") {
				node.setAttribute("target", "_blank");
				node.setAttribute("rel", "noopener noreferrer nofollow");
			}
			return;
		}
		if (node.tagName !== "IMG") return;
		if (profile === "quoted") {
			node.remove();
			return;
		}
		if (!IMAGE_SCHEMES.test(node.getAttribute("src") ?? "")) {
			node.remove();
			return;
		}
		node.setAttribute("style", IMAGE_SIZE);
	});
	return instance;
};

const purifiers = new Map<Profile, ReturnType<typeof DOMPurify>>();

const purifier = (profile: Profile): ReturnType<typeof DOMPurify> => {
	const existing = purifiers.get(profile);
	if (existing) return existing;
	const created = createPurifier(profile);
	purifiers.set(profile, created);
	return created;
};

const sanitize = (html: string, profile: Profile): string =>
	purifier(profile).sanitize(html, {
		ALLOWED_TAGS: ADOPTED_TAGS,
		ALLOWED_ATTR: ADOPTED_ATTR,
		// Both default to true and are honoured outside ALLOWED_ATTR, so a
		// `data-` or `aria-` attribute would otherwise ride along — which is where
		// a web page keeps its own framework's state.
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: false,
	});

/**
 * The paste profile: what may enter — and leave — a document this app sends.
 * It runs on the way in over a clipboard, and again on the way out over the
 * editor's own serialization, which carries the app's stylesheet with it.
 */
export const sanitizeAdoptedHtml = (html: string): string =>
	sanitize(html, "outgoing");

/** The same profile for mail quoted back at its sender, links and images defanged. */
export const sanitizeQuotedHtml = (html: string): string =>
	sanitize(html, "quoted");
