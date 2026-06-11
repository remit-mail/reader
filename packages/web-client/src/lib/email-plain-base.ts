/**
 * Base CSS injected into plain-email iframes (no author background detected,
 * not a newsletter/marketing category).
 *
 * Problem: emails with weak/minimal markup (only a font-color, or nothing)
 * render with the iframe's defaults — serif, black text — which is unreadable
 * in dark mode. Apple Mail's fix: for SIMPLE messages impose the UI sans-serif
 * + theme-aware text color while for genuinely DESIGNED emails (newsletters,
 * marketing) keep them framed and untouched.
 *
 * This module provides the CSS that normalises a plain email. It is injected
 * before the layout-clamp CSS and the email's own markup. The author's font
 * sizes, weights, and link markup pass through; only the base color and
 * font-stack are overridden.
 *
 * Concrete oklch values match the design tokens at the same viewport scale
 * as the app chrome so the reading pane looks continuous. CSS custom
 * properties do NOT cross the iframe boundary, so we inline the resolved
 * values directly.
 *
 * Token map (from packages/ui/src/tokens.css — keep in sync; the
 * `generatePlainEmailBaseCSS` test in email-plain-base.test.ts pins these
 * resolved values so token drift fails loudly):
 *   --fg           light: oklch(0.3 0.025 235)  dark: oklch(0.88 0.02 90)
 *   --surface      light: oklch(0.975 0.012 90)  dark: oklch(0.25 0.025 220)
 *   --accent       light: oklch(0.55 0.14 150)   dark: oklch(0.78 0.16 150)
 */

const FONT_STACK =
	'"Geist Variable", "Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Resolved light-theme values */
const LIGHT = {
	fg: "oklch(0.3 0.025 235)",
	surface: "oklch(0.975 0.012 90)",
	accent: "oklch(0.55 0.14 150)",
};

/** Resolved dark-theme values */
const DARK = {
	fg: "oklch(0.88 0.02 90)",
	surface: "oklch(0.25 0.025 220)",
	accent: "oklch(0.78 0.16 150)",
};

/**
 * Generate CSS that normalises a plain email to the UI font-stack and
 * theme-aware colors. Inject this BEFORE the layout-clamp CSS.
 *
 * Only call this for plain emails (`isPlain = true`). Designed emails
 * (newsletters, author-background detected) should never receive this CSS —
 * their own colors must be preserved exactly.
 */
export const generatePlainEmailBaseCSS = (isDark: boolean): string => {
	const t = isDark ? DARK : LIGHT;
	return `
/* Plain-email base: UI font-stack + theme-aware colors (#424) */
html, body {
  font-family: ${FONT_STACK};
  font-size: 14px;
  line-height: 1.6;
  color: ${t.fg};
  background-color: ${t.surface};
  margin: 0;
  padding: 8px 0;
}
/* Strip author unreadable text colors (color:#000 on dark, etc.) and any
   author element backgrounds, while allowing font-size and font-weight
   variations through. Scoped to body descendants (not the bare universal
   selector) so the themed html/body surface above survives this reset. */
body * {
  color: inherit !important;
  background-color: transparent !important;
}
/* Restore links with a theme-aware accent color */
a, a:visited {
  color: ${t.accent} !important;
  text-decoration: underline;
}
`;
};
