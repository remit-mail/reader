import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountConfigService,
	AccountExportRequestService,
	AccountService,
	AccountSettingService,
	AddressService,
	EnvelopeService,
	FilterAnchorService,
	FilterService,
	LabelService,
	MailboxLockService,
	MailboxService,
	MailboxSpecialUseService,
	MessageFlagPushService,
	MessageFlagService,
	MessageLabelService,
	MessagePlacementMoveService,
	MessageService,
	OrganizeJobRequestService,
	OutboxMessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { env } from "expect-env";
import {
	buildSharedDeps,
	createRemitClient,
	type RemitClient,
	type RemitClientRepositories,
} from "./create-remit-client.js";

const isLocalEnv =
	process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const getDocumentClient = (): DynamoDBDocumentClient => {
	if (isLocalEnv) {
		const port = env.DYNAMODB_PORT;
		const endpoint = `http://localhost:${port}`;

		const ddbClient = new DynamoDBClient({
			endpoint,
			credentials: {
				accessKeyId: "fakeKey",
				secretAccessKey: "fakeSecretKey",
			},
			region: "local",
		});

		return DynamoDBDocumentClient.from(ddbClient);
	}

	const ddbClient = new DynamoDBClient({});
	return DynamoDBDocumentClient.from(ddbClient);
};

export const buildDynamoDBClient = (): RemitClient => {
	const documentClient = getDocumentClient();
	const table = env.DYNAMODB_TABLE_NAME;
	const salt = process.env.DYNAMODB_PAGINATION_SALT ?? "";
	const config = { client: documentClient, table, salt };

	const repositories: RemitClientRepositories = {
		accountConfig: new AccountConfigService(config),
		account: new AccountService(config),
		accountSetting: new AccountSettingService(config),
		address: new AddressService(config),
		mailbox: new MailboxService(config),
		mailboxSpecialUse: new MailboxSpecialUseService(config),
		mailboxLock: new MailboxLockService(config),
		message: new MessageService(config),
		messageFlag: new MessageFlagService(config),
		outboxMessage: new OutboxMessageService(config),
		threadMessage: new ThreadMessageService(config),
		envelope: new EnvelopeService(config),
		accountExportRequest: new AccountExportRequestService(config),
		organizeJobRequest: new OrganizeJobRequestService(config),
		placementMove: new MessagePlacementMoveService(config),
		flagPush: new MessageFlagPushService(config),
		filter: new FilterService(config),
		filterAnchor: new FilterAnchorService(config),
		label: new LabelService(config),
		messageLabel: new MessageLabelService(config),
	};

	return createRemitClient({ repositories, ...buildSharedDeps() });
};
