import type { RemitImapThreadMessageResponse } from "@remit/api-http-client/types.gen.ts";
import { abandonedMutationOf } from "@remit/data-ports/message-settlement";
import { MessageMutation } from "@remit/domain-enums";
import type { ThreadRowData } from "@remit/ui";

/**
 * The row treatment for a message whose mutation Remit gave up on (issue
 * #1002). The client decides nothing: `abandonedMutationOf` owns which values
 * prove a terminal give-up and which operation it was. A copy that gave up
 * leaves a `deleted` row no listing carries, so it reaches no row here; any
 * other row — settled, mid-retry, or in flight — carries no key at all and
 * renders exactly as it always has.
 */
export const rowSettlement = (
	thread: Pick<
		RemitImapThreadMessageResponse,
		"status" | "syncStatus" | "abandonedMutation"
	>,
): Pick<ThreadRowData, "settlement"> => {
	switch (abandonedMutationOf(thread)) {
		case MessageMutation.delete:
			return { settlement: "delete_failed" };
		case MessageMutation.move:
			return { settlement: "move_failed" };
		default:
			return {};
	}
};
