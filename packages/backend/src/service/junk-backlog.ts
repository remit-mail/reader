import type { Logger } from "@remit/logger";
import {
	type JunkBacklogAccount,
	type JunkBacklogResult,
	reevaluateJunkBacklog,
} from "@remit/mailbox-service";
import type { RemitClient } from "./data-client.js";
import { buildOrganizeMoveService } from "./organize.js";

export const runJunkBacklogReevaluation = (
	client: RemitClient<"messageManagement">,
	log: Logger,
	account: JunkBacklogAccount,
	now: number,
): Promise<JunkBacklogResult> =>
	reevaluateJunkBacklog(
		{
			mailboxSpecialUseService: client.mailboxSpecialUse,
			mailboxService: client.mailbox,
			messageService: client.message,
			addressService: client.address,
			storageService: client.storage,
			placementMoveService: buildOrganizeMoveService(client),
			classifierConfig: {
				accountSetting: client.accountSetting,
				accountConfig: client.accountConfig,
				classificationDefault: client.classificationDefault,
				secrets: client.secrets,
				labelService: client.label,
				messageLabelService: client.messageLabel,
				logger: log,
			},
			log,
		},
		account,
		now,
	);
