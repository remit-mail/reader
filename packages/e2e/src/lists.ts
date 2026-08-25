import { expect, type Page } from "@playwright/test";

/**
 * Wait until the named list is the one on screen, not just the one in the URL.
 *
 * Each list is its own route, and a route arrives with its own module: between
 * the click and that module the list the reader came from is still rendered
 * under the new URL. A spec that reads rows on `waitForURL` alone reads the
 * previous list's rows, which is how the brief's row order stood in for the
 * inbox's. The list header names the list, so waiting on it waits for the
 * mounting rather than for the address.
 */
export const listOnScreen = (page: Page, title: RegExp): Promise<void> =>
	expect(page.getByRole("heading", { name: title })).toBeVisible({
		timeout: 30_000,
	});

/** The inbox's own list header. */
export const INBOX_LIST = /^inbox$/i;

/** The Starred list's own list header. */
export const FLAGGED_LIST = /^starred$/i;
