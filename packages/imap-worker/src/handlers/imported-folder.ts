import type { CreateImportedFolder } from "@remit/config-transfer";
import type { IMailboxRepository } from "@remit/data-ports";
import type { MailboxQueueService } from "@remit/mailbox-service";

export const createImportedFolder =
	(
		mailbox: Pick<IMailboxRepository, "findByPath">,
		queue: Pick<MailboxQueueService, "createMailbox">,
	): CreateImportedFolder =>
	async (accountId, folderPath) => {
		const inbox = await mailbox.findByPath(accountId, "INBOX");
		if (!inbox) {
			throw new Error(
				`Account ${accountId} has no INBOX to take a namespace from, so "${folderPath}" cannot be created`,
			);
		}
		return queue.createMailbox(
			{
				accountId,
				namespaceType: inbox.namespaceType,
				namespacePrefix: inbox.namespacePrefix,
				hierarchyDelimiter: inbox.hierarchyDelimiter,
				fullPath: folderPath,
				uidValidity: 0,
				uidNext: 1,
				highestModseq: "0",
				messageCount: 0,
				unseenCount: 0,
				deletedCount: 0,
				totalSize: 0,
				lastSyncUid: 0,
				highWaterMarkUid: 0,
				lastMessageSyncAt: 0,
			},
			accountId,
			true,
		);
	};
