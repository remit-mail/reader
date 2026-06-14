/**
 * Per-account collapse state for the sidebar's custom-folders section.
 *
 * System folders (Inbox, Sent, Drafts, Archive, Junk, Trash) are always
 * visible. The custom "Labels" section is collapsible and its open/closed
 * state survives reloads, keyed per account so collapsing one account's
 * folders doesn't touch another's.
 *
 * Default is collapsed: accounts with many custom folders shouldn't push the
 * system block out of view on first paint.
 */

const STORAGE_PREFIX = "remit.folders.collapsed.";

const storageKey = (accountId: string): string =>
	`${STORAGE_PREFIX}${accountId}`;

/** Whether the custom-folders section is collapsed. Defaults to true. */
export function isFolderSectionCollapsed(accountId: string): boolean {
	if (typeof localStorage === "undefined") return true;
	const stored = localStorage.getItem(storageKey(accountId));
	if (stored === null) return true;
	return stored === "1";
}

/** Persist the collapsed state for one account. */
export function setFolderSectionCollapsed(
	accountId: string,
	collapsed: boolean,
): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(storageKey(accountId), collapsed ? "1" : "0");
}
