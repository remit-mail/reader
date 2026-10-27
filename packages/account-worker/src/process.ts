import type { RemitClient } from "@remit/backend/client";
import type { GroupedQueueProducer } from "@remit/data-ports";
import { createLogger } from "@remit/logger";
import { cascadeServicesOf } from "./cascade.js";
import type { DeletionCapabilities } from "./deletion-capabilities.js";
import type {
	AccountDataPurgeEvent,
	AccountDataPurgeFinalizeEvent,
	OrganizeJobEvent,
	SenderCategoryBackApplyEvent,
} from "./events.js";
import { processAccountDataPurge } from "./handlers/account-purge.js";
import { processAccountDataPurgeFinalize } from "./handlers/account-purge-finalize.js";
import { processOrganizeJob } from "./handlers/organize-job.js";
import { processSenderCategoryBackApply } from "./handlers/sender-category-backapply.js";

export type { CascadeEntity } from "./cascade.js";
export type { DeletionCapabilities } from "./deletion-capabilities.js";
export type { AccountDataPurgeEvent, AccountDataPurgeFinalizeEvent };

export type ClientFanoutEvent = OrganizeJobEvent | SenderCategoryBackApplyEvent;

export interface AccountFanoutContext {
	client: RemitClient<"messageManagement">;
}

export type AccountPurgeEvent =
	| AccountDataPurgeEvent
	| AccountDataPurgeFinalizeEvent;

export interface AccountPurgeContext {
	client: RemitClient;
	purgeQueue: GroupedQueueProducer<AccountDataPurgeFinalizeEvent>;
	capabilities: DeletionCapabilities;
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

export const processAccountPurgeEvent = (
	event: AccountPurgeEvent,
	ctx: AccountPurgeContext,
): Promise<void> => {
	const services = cascadeServicesOf(ctx.client);
	switch (event.type) {
		case "AccountDataPurge":
			return processAccountDataPurge(event, log, {
				services,
				queue: ctx.purgeQueue,
			});
		case "FinalizeAccountDataPurge":
			return processAccountDataPurgeFinalize(event, log, {
				services,
				capabilities: ctx.capabilities,
			});
	}
};
