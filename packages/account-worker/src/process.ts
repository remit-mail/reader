import type { RemitClient } from "@remit/backend/client";
import { createLogger } from "@remit/logger";
import type {
	OrganizeJobEvent,
	SenderCategoryBackApplyEvent,
} from "./events.js";
import { processOrganizeJob } from "./handlers/organize-job.js";
import { processSenderCategoryBackApply } from "./handlers/sender-category-backapply.js";

export type ClientFanoutEvent = OrganizeJobEvent | SenderCategoryBackApplyEvent;

export interface AccountFanoutContext {
	client: RemitClient<"messageManagement">;
}

const log = createLogger();

export const processAccountFanoutEvent = (
	event: ClientFanoutEvent,
	ctx: AccountFanoutContext,
): Promise<void> => {
	switch (event.type) {
		case "OrganizeJob":
			return processOrganizeJob(event, log, { client: ctx.client });
		case "SenderCategoryBackApply":
			return processSenderCategoryBackApply(event, log, { client: ctx.client });
	}
};
