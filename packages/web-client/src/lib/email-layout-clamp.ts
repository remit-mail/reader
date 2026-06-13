/**
 * Layout-clamp CSS injected into rendered email bodies.
 *
 * Author markup commonly sets explicit pixel widths via `<table width="600">`,
 * `<img width="900">`, oversized inline styles, or long unbroken URLs. On a
 * narrow viewport these push `.email-content` past the parent column and
 * unlock horizontal page scroll. We clamp media + tables to the container
 * width and wrap long words so the body never exceeds its frame.
 *
 * Layout-only: colors, backgrounds and typography are untouched (that is the
 * dark-mode CSS's job). Uses `!important` because author width attributes
 * win the cascade otherwise; the cascade win is the entire point on mobile.
 * Not wrapped in a media query — natural content width still affects parent
 * layout on desktop if it's wider than the column.
 *
 * In its own module so tests can import it without triggering the eager
 * `DOMPurify()` call at the bottom of `email-sanitizer.ts` (which needs a DOM).
 */
export const generateLayoutClampCSS = (): string => `
/* Zero the UA default body margin so iframe content fills edge-to-edge */
html, body { margin: 0; padding: 0; }
/* Layout clamp for email content - keeps wide author markup inside the column */
.email-content {
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.email-content img,
.email-content video,
.email-content iframe {
  max-width: 100% !important;
  height: auto !important;
}
.email-content table {
  max-width: 100% !important;
  width: auto !important;
  table-layout: auto;
}
.email-content pre,
.email-content code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
`;
