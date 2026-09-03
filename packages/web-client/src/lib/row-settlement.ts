import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { messageSettlementOf } from "@remit/data-ports";
import type { ThreadRowData } from "@remit/ui";

/**
 * The row treatment for a message whose last IMAP mutation has not settled
 * (issue #1002). Derived from the server's own `status`/`syncStatus` pair by
 * `messageSettlementOf`, the same rule the mutation guards read — the client
 * never decides for itself what counts as unsettled. A settled row carries no
 * key at all, so it renders exactly as it always has.
 */
export const rowSettlement = (
	thread: Pick<RemitImapThreadMessageResponse, "status" | "syncStatus">,
): Pick<ThreadRowData, "settlement"> => {
	const settlement = messageSettlementOf(thread);
	return settlement === "settled" ? {} : { settlement };
};
