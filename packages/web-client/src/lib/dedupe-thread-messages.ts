import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";

/**
 * Pure helper: collapse a flattened list of thread messages to one row per
 * `threadMessageId`, keeping the first occurrence.
 *
 * Belt-and-braces guard for issue #166. The web client appends every fetched
 * page as-is and relies on the keyset cursor never handing back an overlapping
 * page. `threadMessageId` is unique per message, so two rows sharing one are
 * the same message — dropping the later row removes a duplicate, never a
 * distinct result. Applied where pages are flattened into the list, so every
 * consumer of the list sees a clean array and no render site has to remember
 * to dedupe.
 */
export const dedupeThreadMessages = (
	items: RemitImapThreadMessageResponse[],
): RemitImapThreadMessageResponse[] => {
	const seen = new Set<string>();
	const deduped: RemitImapThreadMessageResponse[] = [];
	for (const item of items) {
		if (seen.has(item.threadMessageId)) continue;
		seen.add(item.threadMessageId);
		deduped.push(item);
	}
	return deduped;
};
