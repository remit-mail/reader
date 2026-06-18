/**
 * Layout-clamp CSS injected into rendered email bodies.
 *
 * Author markup commonly sets explicit pixel widths via `<table width="600">`,
 * `<img width="900">`, oversized inline styles, or long unbroken URLs. On a
 * narrow viewport these push the body past the iframe's width and unlock
 * horizontal page scroll, dragging the surrounding app chrome with them (#727).
 * We clamp the body and its media + tables to the viewport width and wrap long
 * unbroken tokens so the rendered email fits the frame on a phone.
 *
 * The sanitizer prepends this block to the raw (DOMPurify'd) email and drops it
 * into the iframe with no `.email-content` wrapper, so the rules target the
 * iframe's own `html`/`body` and the document's media/table/code elements
 * directly — a wrapper-scoped selector would never match.
 *
 * Layout-only: colors, backgrounds and typography are untouched (that is the
 * dark-mode / smart-invert CSS's job in `IsolatedEmailFrame`). Uses
 * `!important` because author width attributes win the cascade otherwise; the
 * cascade win is the entire point on mobile. Not wrapped in a media query —
 * natural content width still affects parent layout on desktop if it's wider
 * than the column.
 *
 * In its own module so tests can import it without triggering the eager
 * `DOMPurify()` call at the bottom of `email-sanitizer.ts` (which needs a DOM).
 */
export const generateLayoutClampCSS = (): string => `
/* Zero the UA default body margin and clamp the document to the iframe width so
   wide author markup can't push the body (and the page) past the viewport. */
html, body {
  margin: 0;
  padding: 0;
  max-width: 100%;
}
body {
  overflow-wrap: anywhere;
  word-break: break-word;
}
/* Media never wider than the frame; keep aspect ratio when width is capped. */
img, video, iframe, svg, canvas {
  max-width: 100% !important;
  height: auto;
}
/* Fixed-width author tables (\`<table width="600">\`) collapse to fit. */
table {
  max-width: 100% !important;
  table-layout: auto;
}
/* Long unbroken strings (URLs, tokens) wrap instead of forcing a wide line. */
pre, code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
`;
