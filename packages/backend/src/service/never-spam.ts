import type {
	AccountFanoutEvent,
	QueueProducer,
	SenderNeverSpamBackApplyEvent,
} from "@remit/data-ports";
import {
	backApplyNeverSpam,
	type NeverSpamBackApplyResult,
	type NeverSpamGrant,
} from "@remit/mailbox-service";
import type { RemitClient } from "./data-client.js";
import { buildOrganizeMoveService } from "./organize.js";

export const requestNeverSpamBackApply = (
	queue: QueueProducer<AccountFanoutEvent>,
	grant: NeverSpamGrant,
): Promise<void> =>
	queue
		.send({ body: { type: "SenderNeverSpamBackApply", ...grant } })
		.catch((cause: unknown) => {
			throw new Error(
				`Never spam is saved for ${grant.normalizedEmail} and applies to their next message, but moving their mail already in Junk could not be started. Turning never spam on again for this sender retries it.`,
				{ cause },
			);
		});

export const runNeverSpamBackApply = (
	client: RemitClient<"messageManagement" | "accountFanout">,
	event: SenderNeverSpamBackApplyEvent,
	now: number,
): Promise<NeverSpamBackApplyResult> =>
	backApplyNeverSpam(
		{
			accountService: client.account,
			addressService: client.address,
			mailboxSpecialUseService: client.mailboxSpecialUse,
			messageService: client.message,
			placementMoveService: buildOrganizeMoveService(client),
			fanoutQueue: client.queues.accountFanout,
		},
		event,
		now,
	);
