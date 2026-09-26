import type { HttpHandler } from "msw";

/**
 * Handlers every story shares. A web-client route story brings its own through
 * `parameters.msw`, built by `mailHandlers` in the web-client story frame.
 */
export const handlers: HttpHandler[] = [];
