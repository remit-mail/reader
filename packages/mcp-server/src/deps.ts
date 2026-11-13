import type { RemitClient } from "@remit/backend/client";
import type {
	IAccountRepository,
	IAccountSettingRepository,
	IAddressRepository,
	IFilterRepository,
	ILabelMailboxRepository,
	ILabelRepository,
	IMailboxRepository,
	IMailboxSpecialUseRepository,
	IMessageLabelRepository,
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
	MessageMoveService,
	OrganizeJobLogger,
} from "@remit/mailbox-service";
import type { StorageService } from "@remit/storage-service";

export const FOLDER_SETTLE_TIMEOUT_MS = 20_000;
export const FOLDER_POLL_INTERVAL_MS = 500;

export interface FolderToolDeps {
	mailboxQueue: Pick<
		MailboxQueueService,
		"createMailbox" | "renameMailbox" | "dismissMailboxIntent" | "deleteMailbox"
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
	account: Pick<
		IAccountRepository,
		"get" | "listAllByAccountConfig" | "listMailSourcesByAccountConfig"
	>;
	mailbox: Pick<
		IMailboxRepository,
		| "get"
		| "listAllByAccount"
		| "findByPath"
		| "findByPathPrefix"
		| "resolveAccountId"
	>;
	accountSetting: Pick<IAccountSettingRepository, "get">;
	mailboxSpecialUse: Pick<IMailboxSpecialUseRepository, "resolveTrashRole">;
	address: Pick<IAddressRepository, "countCategoryOverridesSince">;
	label: Pick<
		ILabelRepository,
		"create" | "findByNormalizedName" | "get" | "listByAccountConfig"
	>;
	labelMailbox: Pick<
		ILabelMailboxRepository,
		"get" | "put" | "listByAccount" | "listByLabel"
	>;
	message: Pick<
		IMessageRepository,
		"get" | "describe" | "countClassifiedSince"
	>;
	messageLabel: Pick<IMessageLabelRepository, "apply">;
	messageMove: Pick<MessageMoveService, "moveMessages" | "deleteMessages">;
	threadMessage: Pick<
		IThreadMessageRepository,
		"listByMailbox" | "listByThread" | "searchByDate" | "countByMailbox"
	>;
	filter: Pick<
		IFilterRepository,
		"listByAccountConfig" | "refreshExpiry" | "create" | "get" | "update"
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
	accountSetting: client.accountSetting,
	mailboxSpecialUse: client.mailboxSpecialUse,
	address: client.address,
	label: client.label,
	labelMailbox: client.labelMailbox,
	message: client.message,
	messageLabel: client.messageLabel,
	messageMove: client.messageMove,
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
