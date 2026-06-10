import type { HttpHandler } from "msw";

/**
 * MSW harness stays wired (preview.tsx) for future data-driven stories,
 * but every current story is static and fixture-driven — no handlers.
 * Add request handlers here when a story needs to exercise real fetch
 * flows against the generated API surface.
 */
export const handlers: HttpHandler[] = [];
