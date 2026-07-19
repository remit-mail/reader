/**
 * The screen composition: the generated route tree and the router factory that
 * binds it to a query client and telemetry. A distributor composes these into
 * the app shell as-is, or feeds the route tree to its own router. The tree is
 * generated from `src/routes` by the TanStack router plugin.
 */
export { createAppRouter, type RouterContext } from "./router";
export { routeTree } from "./routeTree.gen";
