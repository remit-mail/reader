/**
 * A constant-size ring of the last few in-app navigations, captured from the
 * router's `onResolved` event (see router.tsx). It gives a bug report a
 * navigation trail, so "Steps to reproduce" has something concrete even when
 * the reporter leaves the template blank.
 *
 * PRIVACY — like request breadcrumbs, this is METADATA ONLY and the tracker is
 * public. A route entry is the resolved PATHNAME and a timestamp. The query
 * string is dropped: a search route's `?q=` carries the user's query text.
 * Opaque path ids (a message id in the path) are acceptable — they already
 * appear in the report's URL section.
 */

export interface RouteBreadcrumb {
	/** Resolved pathname only — never the query string (see file header). */
	path: string;
	timestamp: string;
}

const MAX_ENTRIES = 8;

const ring: RouteBreadcrumb[] = [];

/**
 * Record a navigation. `path` is expected to be a pathname; any query or hash
 * is stripped defensively so a caller passing a full location cannot leak query
 * text into a breadcrumb.
 */
export function recordRoute(path: string): void {
	const clean = path.split(/[?#]/)[0];
	const last = ring[ring.length - 1];
	if (last && last.path === clean) return;
	ring.push({ path: clean, timestamp: new Date().toISOString() });
	if (ring.length > MAX_ENTRIES) ring.shift();
}

/** The captured navigations, oldest first. A copy — callers cannot mutate the ring. */
export function getRecentRoutes(): readonly RouteBreadcrumb[] {
	return ring.slice();
}

/** Test-only: clear the ring. */
export function __resetRouteBreadcrumbs(): void {
	ring.length = 0;
}
