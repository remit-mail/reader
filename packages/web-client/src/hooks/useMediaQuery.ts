import { DESKTOP_MEDIA_QUERY, useMatchMedia } from "@remit/ui";

/**
 * True at desktop (Tailwind `lg:` and up): at least 1024px wide and not a
 * touch screen held upright. Everything else renders the single-pane mobile
 * layout — phones, narrow tablets, and a large tablet in portrait, which is
 * 1024px wide but has no room for the three-pane desktop grid (#682).
 *
 * The CSS-gated mobile chrome (Drawer, ComposeFab) uses `lg:hidden`, and the
 * `lg` variant is redefined in `@remit/ui`'s token sheet with the same
 * condition — change `DESKTOP_MEDIA_QUERY` and both move together.
 */
export const useIsDesktop = (): boolean => useMatchMedia(DESKTOP_MEDIA_QUERY);
