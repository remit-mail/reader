/**
 * Holding a request in flight, so a spec can decide what the client reads back
 * and when.
 */
import type { Page } from "@playwright/test";

export interface HoldRouteOptions {
	/** The requests are released once this settles. */
	until: Promise<unknown>;
	/**
	 * The methods to hold. Everything else on the same path continues the moment
	 * it is intercepted.
	 */
	methods?: string[];
}

/**
 * Hold every matching request until `until` settles, and continue anything
 * outside `methods` straight away.
 *
 * A path is one route to Playwright but several operations to the app, and the
 * gate is normally waiting on one of them: holding a compose path's autosave
 * PATCH parks the write whose effect the gate is waiting for, and neither side
 * ever moves. So the filter defaults to reads, and a spec that means to hold a
 * write says so.
 */
export const holdRoute = async (
	page: Page,
	pattern: string | RegExp,
	{ until, methods = ["GET"] }: HoldRouteOptions,
): Promise<void> => {
	const held = new Set(methods.map((method) => method.toUpperCase()));
	await page.route(pattern, async (route) => {
		if (!held.has(route.request().method())) return route.continue();
		await until;
		await route.continue();
	});
};
