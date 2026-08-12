/**
 * Base CSS injected into the isolated email iframe, by treatment.
 *
 * `IsolatedEmailFrame` owns the full srcDoc, so the "make an untrusted email
 * readable + theme-aware" decision lives here in one place rather than spread
 * across the call site. The sanitizer still prepends its own layout-clamp block
 * (width/wrap rules) ahead of the email body; this module supplies the colour /
 * font / dark-mode canvas that sits in front of it.
 *
 * Two treatments:
 *
 * - `plain` — weakly-marked / personal mail with no author background. Gets the
 *   UI sans-serif + theme-aware colours so black-text-on-dark is readable.
 * - `framed` — designed mail (newsletter / marketing / author background). Its
 *   own colours are preserved; in dark mode it is darkened via a K-9-style
 *   smart-invert unless it opts into its own dark design.
 */

const FONT_STACK =
	'"Geist Variable", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Resolved theme tokens, inlined because CSS custom properties do not cross the
 * iframe boundary. Keep in sync with `tokens.css`; the unit test pins these
 * resolved values so token drift fails loudly.
 *
 * `canvas` is the reading pane's own ground, not `surface`: whenever the app
 * supplies the background the frame must be indistinguishable from the pane
 * around it, or the email reads as a lighter rectangle sitting inside the pane.
 *
 *   --fg      light: oklch(0.3 0.025 235)  dark: oklch(0.88 0.02 90)
 *   --canvas  light: oklch(0.96 0.015 90)  dark: oklch(0.22 0.025 220)
 *   --accent  light: oklch(0.55 0.14 150)  dark: oklch(0.78 0.16 150)
 */
const FRAME_TOKENS = {
	light: {
		fg: "oklch(0.3 0.025 235)",
		canvas: "oklch(0.96 0.015 90)",
		accent: "oklch(0.55 0.14 150)",
	},
	dark: {
		fg: "oklch(0.88 0.02 90)",
		canvas: "oklch(0.22 0.025 220)",
		accent: "oklch(0.78 0.16 150)",
	},
} as const;

/**
 * What the mail declares about its own presentation. Both facts are read off
 * the raw author markup by the sanitizer, and both decide whether the app
 * supplies something or stands back:
 *
 * - `background` — the mail paints its own ground, so it renders as authored.
 *   When it declares none, the app's ground is the reading pane's own colour.
 * - `spacing` — the mail lays out its own padding or margin. When it declares
 *   none, the app injects breathing room INSIDE the background, so the ground
 *   still runs edge to edge and only the text is inset.
 */
export interface AuthorDeclarations {
	background: boolean;
	spacing: boolean;
}

const NOTHING_DECLARED: AuthorDeclarations = {
	background: false,
	spacing: false,
};

/**
 * The inset between the email's own ground and its text, for mail that lays out
 * none of its own. Matches the reading pane's desktop gutter, so a bare message
 * reads with the same rhythm as the chrome above it.
 */
const CONTENT_INSET = "16px";

/**
 * Breathing room for a mail that brings none, painted inside the element that
 * carries the background rather than around it. Emitted LAST in the document so
 * it beats the layout clamp's `padding: 0` reset; `border-box` keeps the padded
 * body inside the frame instead of pushing 32px of content past its right edge.
 */
export const generateContentInsetCSS = (): string =>
	`html{padding:0}body{padding:${CONTENT_INSET};box-sizing:border-box}`;

/**
 * The document is its own scrollport. The frame is exactly as wide as the pane
 * and is never widened to fit the mail, so content that genuinely cannot wrap —
 * a fixed-width table, an image with its own `min-width`, a `pre` the author
 * pinned — has to be reachable from inside the document rather than by handing
 * the app a wider box to hold.
 *
 * `body` only becomes a scroll container once `html` stops being `visible`:
 * overflow set on the body propagates to the viewport otherwise, which would put
 * the scrollbar back on the frame itself. Pinning `html` first is what keeps the
 * scroll where the content is.
 */
export const generateScrollportCSS = (): string =>
	"html{overflow:hidden}body{overflow-x:auto}";

/**
 * Detects whether a (sanitized) email opts into dark rendering — either via a
 * `prefers-color-scheme: dark` media query or an explicit `color-scheme: dark`
 * declaration. Whitespace inside the value is tolerated. When present we honour
 * the author's intent instead of forcing white or smart-inverting.
 */
export const DARK_OPT_IN_RE =
	/prefers-color-scheme\s*:\s*dark|color-scheme\s*:\s*[^;}"']*\bdark\b/i;

/**
 * Pin the iframe's layout viewport to its own width so author `width=device-
 * width` assumptions resolve to the frame, and a wide fixed-layout email lays
 * out against the frame instead of a desktop-default 980px viewport that would
 * zoom the whole document out on a phone (#727).
 */
export const VIEWPORT_META =
	'<meta name="viewport" content="width=device-width, initial-scale=1">';

/**
 * Plain-email base CSS: UI font-stack + theme-aware colours. Strips author
 * unreadable text colours (`color:#000` on dark) and element backgrounds while
 * letting font-size / weight variations through, and re-themes links.
 */
export const generatePlainEmailBaseCSS = (isDark: boolean): string => {
	const t = isDark ? FRAME_TOKENS.dark : FRAME_TOKENS.light;
	return `
/* Plain-email base: UI font-stack + theme-aware colors (#424) */
html, body {
  font-family: ${FONT_STACK};
  font-size: 14px;
  line-height: 1.6;
  color: ${t.fg};
  background-color: ${t.canvas};
  margin: 0;
  padding: 0;
}
/* Strip author unreadable text colors and element backgrounds, scoped to body
   descendants so the themed html/body surface above survives this reset. */
body * {
  color: inherit !important;
  background-color: transparent !important;
}
a, a:visited {
  color: ${t.accent} !important;
  text-decoration: underline;
}
`;
};

const SMART_INVERT = "invert(0.92) hue-rotate(180deg)";
const RE_INVERT_MEDIA = `img,picture,video,svg,canvas,[style*='background-image'],[background]{filter:${SMART_INVERT}}`;

/**
 * Framed-email base CSS, mirroring K-9 Mail's dark-reading strategy, split
 * first on whether the mail brought a ground of its own.
 *
 * The mail declared one — render it as authored: white canvas in light, and in
 * dark either the author's own dark design or the smart-invert that darkens a
 * white-assuming email into the pane.
 *
 * The mail declared none — the app supplies the ground, and an app-supplied
 * ground is the reading pane's own colour, so the email is one surface with the
 * pane rather than a rectangle inside it. In dark the invert moves off `html`
 * onto `body`: the author's colours still darken, but the canvas behind them is
 * the pane's and is never inverted into a white-turned-charcoal slab.
 *
 * `invert(0.92)` (not 1.0) lands on soft charcoal + light-grey like K-9 rather
 * than pure black/white; `hue-rotate(180deg)` keeps blues blue (links); the
 * media-element rule re-inverts images / logos / photos back to their natural
 * colours. No `!important` — this is a default canvas, so the email's own
 * background still composes. The margin reset zeroes the UA body margin.
 */
export const generateFramedEmailBaseCSS = (
	isDark: boolean,
	optsIntoDark: boolean,
	hasAuthorBackground: boolean,
): string => {
	const canvas = isDark ? FRAME_TOKENS.dark.canvas : FRAME_TOKENS.light.canvas;
	if (!hasAuthorBackground) {
		if (!isDark)
			return `html,body{margin:0;background-color:${canvas};color-scheme:light}`;
		if (optsIntoDark)
			return `html,body{margin:0;background-color:${canvas};color-scheme:dark light}`;
		return `html{margin:0;background-color:${canvas}}body{margin:0;filter:${SMART_INVERT}}${RE_INVERT_MEDIA}`;
	}
	if (!isDark)
		return "html,body{margin:0;background-color:#ffffff;color-scheme:light}";
	if (optsIntoDark)
		return `html,body{margin:0;background-color:${canvas};color-scheme:dark light}`;
	return `html{margin:0;background-color:#ffffff;filter:${SMART_INVERT}}body{margin:0}${RE_INVERT_MEDIA}`;
};

export type EmailFrameVariant = "plain" | "framed";

/**
 * Assemble the full srcDoc for an isolated email frame: the viewport meta, the
 * treatment's base CSS, the (already sanitized, layout-clamped) email HTML, and
 * last — where they outrank the clamp's own resets — the scrollport and, for
 * mail that lays out none of its own, the content inset. This is the single
 * place the colour / font / dark-mode / spacing decision is applied; callers
 * pass treatment, theme and what the mail declares, never raw CSS.
 */
export const buildEmailSrcDoc = (
	html: string,
	variant: EmailFrameVariant,
	isDark: boolean,
	declares: AuthorDeclarations = NOTHING_DECLARED,
): string => {
	const base =
		variant === "plain"
			? generatePlainEmailBaseCSS(isDark)
			: generateFramedEmailBaseCSS(
					isDark,
					DARK_OPT_IN_RE.test(html),
					declares.background,
				);
	const inset = declares.spacing ? "" : generateContentInsetCSS();
	return `${VIEWPORT_META}<style>${base}</style>${html}<style>${generateScrollportCSS()}${inset}</style>`;
};
