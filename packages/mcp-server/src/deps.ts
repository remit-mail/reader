import type {
	IAccountRepository,
	IMailboxRepository,
	IMessageRepository,
	IThreadMessageRepository,
} from "@remit/data-ports";
import type {
	BodyPartMaterializer,
	BodySyncCue,
	MailboxQueueService,
	MaterializeLogger,
} from "@remit/mailbox-service";
import type { StorageService } from "@remit/storage-service";

export interface FolderToolDeps {
	mailboxQueue: Pick<
		MailboxQueueService,
		"createMailbox" | "renameMailbox" | "dismissMailboxIntent"
	>;
	settleTimeoutMs: number;
	pollIntervalMs: number;
}

export interface McpDeps {
	account: Pick<IAccountRepository, "get" | "listAllByAccountConfig">;
	mailbox: Pick<IMailboxRepository, "get" | "listAllByAccount">;
	message: Pick<IMessageRepository, "get" | "describe">;
	threadMessage: Pick<
		IThreadMessageRepository,
		"listByMailbox" | "listByThread" | "searchByDate"
	>;
	storage: Pick<StorageService, "retrieveBodyPart">;
	bodySync: BodyPartMaterializer;
	bodySyncQueue: BodySyncCue | undefined;
	logger: MaterializeLogger;
	folders?: FolderToolDeps;
}
