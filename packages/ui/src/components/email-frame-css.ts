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
 *   --fg       light: oklch(0.3 0.025 235)   dark: oklch(0.88 0.02 90)
 *   --surface  light: oklch(0.975 0.012 90)  dark: oklch(0.25 0.025 220)
 *   --accent   light: oklch(0.55 0.14 150)   dark: oklch(0.78 0.16 150)
 */
const PLAIN_TOKENS = {
	light: {
		fg: "oklch(0.3 0.025 235)",
		surface: "oklch(0.975 0.012 90)",
		accent: "oklch(0.55 0.14 150)",
	},
	dark: {
		fg: "oklch(0.88 0.02 90)",
		surface: "oklch(0.25 0.025 220)",
		accent: "oklch(0.78 0.16 150)",
	},
} as const;

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
	const t = isDark ? PLAIN_TOKENS.dark : PLAIN_TOKENS.light;
	return `
/* Plain-email base: UI font-stack + theme-aware colors (#424) */
html, body {
  font-family: ${FONT_STACK};
  font-size: 14px;
  line-height: 1.6;
  color: ${t.fg};
  background-color: ${t.surface};
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

/**
 * Framed-email base CSS, mirroring K-9 Mail's dark-reading strategy. Three
 * cases, driven by app theme + the email's own dark opt-in:
 *
 * - App light theme → render as authored on a white canvas (light scheme).
 * - App dark theme + email opts into its own dark → render as authored.
 * - App dark theme, no opt-in → CSS smart-invert to darken the email into the
 *   dark pane: soft charcoal background, light-grey text.
 *
 * `invert(0.92)` (not 1.0) lands on soft charcoal + light-grey like K-9 rather
 * than pure black/white; the white `html` background gives the invert a light
 * source; `hue-rotate(180deg)` keeps blues blue (links); the media-element rule
 * re-inverts images / logos / photos back to their natural colours. No
 * `!important` — this is a default canvas, so the email's own background still
 * composes. The margin reset zeroes the UA body margin.
 */
export const generateFramedEmailBaseCSS = (
	isDark: boolean,
	optsIntoDark: boolean,
): string => {
	if (!isDark)
		return "html,body{margin:0;background-color:#ffffff;color-scheme:light}";
	if (optsIntoDark) return "html,body{margin:0;color-scheme:dark light}";
	return "html{margin:0;background-color:#ffffff;filter:invert(0.92) hue-rotate(180deg)}body{margin:0}img,picture,video,svg,canvas,[style*='background-image'],[background]{filter:invert(0.92) hue-rotate(180deg)}";
};

export type EmailFrameVariant = "plain" | "framed";

/**
 * Assemble the full srcDoc for an isolated email frame: the viewport meta, the
 * treatment's base CSS, then the (already sanitized, layout-clamped) email
 * HTML. This is the single place the colour / font / dark-mode decision is
 * applied — callers pass treatment + theme, never raw CSS.
 */
export const buildEmailSrcDoc = (
	html: string,
	variant: EmailFrameVariant,
	isDark: boolean,
): string => {
	if (variant === "plain") {
		return `${VIEWPORT_META}<style>${generatePlainEmailBaseCSS(isDark)}</style>${html}`;
	}
	const optsIntoDark = DARK_OPT_IN_RE.test(html);
	return `${VIEWPORT_META}<style>${generateFramedEmailBaseCSS(isDark, optsIntoDark)}</style>${html}`;
};
