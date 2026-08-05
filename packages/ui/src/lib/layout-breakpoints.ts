export const DESKTOP_MIN_WIDTH = 1024;

/**
 * The desktop gate. Width alone is not enough: a large tablet in portrait is
 * exactly 1024px wide, and the multi-pane shell does not fit a surface held
 * upright. A coarse pointer in portrait therefore never counts as desktop,
 * while a tall monitor (fine pointer) still does.
 *
 * `tokens.css` redefines Tailwind's `lg` variant with this exact condition,
 * so the CSS-gated chrome and anything reading the query in JS flip together.
 */
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px) and (not ((orientation: portrait) and (pointer: coarse)))`;
