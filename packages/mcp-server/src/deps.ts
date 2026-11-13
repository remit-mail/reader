import type { RemitClient } from "@remit/backend/client";
import type {
	IAccountRepository,
	IAddressRepository,
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

export const FOLDER_SETTLE_TIMEOUT_MS = 20_000;
export const FOLDER_POLL_INTERVAL_MS = 500;

export interface FolderToolDeps {
	mailboxQueue: Pick<
		MailboxQueueService,
		"createMailbox" | "renameMailbox" | "dismissMailboxIntent"
	>;
	settleTimeoutMs: number;
	pollIntervalMs: number;
	sleep: (ms: number) => Promise<void>;
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
	address: Pick<IAddressRepository, "countCategoryOverridesSince">;
	message: Pick<
		IMessageRepository,
		"get" | "describe" | "countClassifiedSince"
	>;
	threadMessage: Pick<
		IThreadMessageRepository,
		"listByMailbox" | "listByThread" | "searchByDate"
	>;
	filter: Pick<
		IFilterRepository,
		"listPageByAccountConfig" | "refreshExpiry" | "create" | "get" | "update"
	>;
	organizeJobRequest: Pick<IOrganizeJobRequestRepository, "create" | "get">;
	storage: Pick<StorageService, "retrieveBodyPart">;
	bodySync: BodyPartMaterializer;
	bodySyncQueue: BodySyncCue;
	logger: MaterializeLogger;
	folders: FolderToolDeps;
	filters: FilterToolDeps;
}

export interface McpDepsExtras {
	logger: MaterializeLogger & OrganizeJobLogger;
	settle: Omit<FolderToolDeps, "mailboxQueue">;
}

export const mcpDepsOf = (
	client: RemitClient,
	{ logger, settle }: McpDepsExtras,
): McpDeps => ({
	account: client.account,
	mailbox: client.mailbox,
	address: client.address,
	message: client.message,
	threadMessage: client.threadMessage,
	filter: client.filter,
	organizeJobRequest: client.organizeJobRequest,
	storage: client.storage,
	bodySync: client.bodySync,
	bodySyncQueue: client.bodySyncQueue,
	logger,
	folders: { mailboxQueue: client.mailboxQueue, ...settle },
	filters: { organizeQueue: client.queues.accountFanout, logger },
});
