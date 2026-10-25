import type {
	IAccountRepository,
	IFilterRepository,
	IMailboxRepository,
	IMessageRepository,
	IOrganizeJobRequestRepository,
	IThreadMessageRepository,
	OrganizeJobEvent,
	QueueProducer,
} from "@remit/data-ports";
import type {
	BodyPartMaterializer,
	BodySyncCue,
	MailboxQueueService,
	MaterializeLogger,
	OrganizeJobLogger,
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

export interface FilterToolDeps {
	organizeQueue: QueueProducer<OrganizeJobEvent>;
	logger: OrganizeJobLogger;
}

export interface McpDeps {
	account: Pick<IAccountRepository, "get" | "listAllByAccountConfig">;
	mailbox: Pick<
		IMailboxRepository,
		"get" | "listAllByAccount" | "findByPath" | "resolveAccountId"
	>;
	message: Pick<IMessageRepository, "get" | "describe">;
	threadMessage: Pick<
		IThreadMessageRepository,
		"listByMailbox" | "listByThread" | "searchByDate"
	>;
	filter: Pick<
		IFilterRepository,
		"listPageByAccountConfig" | "refreshExpiry" | "create" | "get" | "update"
	>;
	organizeJobRequest: Pick<IOrganizeJobRequestRepository, "create">;
	storage: Pick<StorageService, "retrieveBodyPart">;
	bodySync: BodyPartMaterializer;
	bodySyncQueue: BodySyncCue;
	logger: MaterializeLogger;
	folders: FolderToolDeps;
	filters: FilterToolDeps;
}
