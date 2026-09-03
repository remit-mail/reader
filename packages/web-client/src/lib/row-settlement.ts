import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { hasAbandonedDelete } from "@remit/data-ports/message-settlement";
import type { ThreadRowData } from "@remit/ui";

/**
 * The row treatment for a message whose delete Remit abandoned (issue #1002). The
 * client decides nothing: `hasAbandonedDelete` owns which `status`/`syncStatus`
 * pair proves a terminal give-up, and why no other pair does. Any other row —
 * settled, mid-retry, or an undecidable move — carries no key at all and
 * renders exactly as it always has.
 */
export const rowSettlement = (
	thread: Pick<RemitImapThreadMessageResponse, "status" | "syncStatus">,
): Pick<ThreadRowData, "settlement"> =>
	hasAbandonedDelete(thread) ? { settlement: "delete_failed" } : {};
