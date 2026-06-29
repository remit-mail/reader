import type { RemitImapMessageCategory } from "@remit/api-http-client/types.gen.ts";
import type { ThreadCategory } from "@remit/ui";

/**
 * Map an API message category to a kit display category.
 *
 * The API category is total (RFC 032 Tier 2) and carries `uncategorized` for
 * messages that are metadata-synced but not yet body-classified. The kit's
 * display unions (`ThreadCategory`, `EmailRenderCategory`, badge `MessageCategory`)
 * have no `uncategorized` member — there is nothing to show for "not yet
 * classified", so it collapses to `personal`, the classifier's own fallback and
 * the display default that never renders a badge. Pre-migration rows that still
 * read `undefined` collapse the same way.
 */
export function toDisplayCategory(
	category: RemitImapMessageCategory | undefined,
): ThreadCategory {
	if (category === undefined || category === "uncategorized") return "personal";
	return category;
}
