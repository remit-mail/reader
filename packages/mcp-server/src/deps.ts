import type {
	IAccountRepository,
	IMailboxRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type { BodySyncService } from "@remit/mailbox-service";
import type { StorageService } from "@remit/storage-service";

export interface McpDeps {
	account: Pick<IAccountRepository, "listAllByAccountConfig">;
	mailbox: Pick<IMailboxRepository, "get" | "listAllByAccount">;
	message: Pick<IMessageRepository, "get" | "describe">;
	threadMessage: Pick<
		IThreadMessageRepository,
		"listByMailbox" | "listByThread" | "searchByDate"
	>;
	storage: Pick<StorageService, "retrieveBodyPart">;
	bodySync: Pick<BodySyncService, "ensureBodyPartsStored">;
}
