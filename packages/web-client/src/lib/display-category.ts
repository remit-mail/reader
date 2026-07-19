import type { RemitImapMessageCategory } from "@remit/api-http-client/types.gen.ts";
import type { ThreadCategory } from "@remit/ui";

/**
 * Map an API message category to a kit display category.
 *
 * The API category is total (RFC 032 Tier 2) and carries `uncategorized` for
 * messages that are metadata-synced but not yet body-classified. That state is
 * shown as itself, not collapsed into `personal`: collapsing made an
 * unclassified message identical on screen to one the classifier positively
 * decided was personal, so a classification gap read as a large personal inbox
 * rather than as missing work (issue #45).
 *
 * Pre-migration rows that read `undefined` carry no category either, so they
 * map to `uncategorized` the same way.
 */
export function toDisplayCategory(
	category: RemitImapMessageCategory | undefined,
): ThreadCategory {
	if (category === undefined) return "uncategorized";
	return category;
}
