import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	AccountService,
	EnvelopeService,
	MailboxService,
	MailboxSpecialUseService,
	MessageFlagService,
	MessageService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import {
	FlagQueueService,
	MailboxQueueService,
	MessageMoveService,
} from "@remit/mailbox-service";
import { env } from "expect-env";
import { logger } from "../logger.js";

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

export interface RemitClient {
	// ElectroDB services (reads)
	account: AccountService;
	mailbox: MailboxService;
	mailboxSpecialUse: MailboxSpecialUseService;
	message: MessageService;
	messageFlag: MessageFlagService;
	threadMessage: ThreadMessageService;
	envelope: EnvelopeService;

	// Queue services (writes with IMAP sync)
	flagQueue: FlagQueueService;
	mailboxQueue: MailboxQueueService;
	messageMove: MessageMoveService;
}

let client: RemitClient | null = null;

export const getClient = (): RemitClient => {
	if (!client) {
		const documentClient = getDocumentClient();
		const table = env.DYNAMODB_TABLE_NAME;
		const salt = process.env.DYNAMODB_PAGINATION_SALT ?? "";
		const config = { client: documentClient, table, salt };

		// ElectroDB services
		const accountService = new AccountService(config);
		const mailboxService = new MailboxService(config);
		const mailboxSpecialUseService = new MailboxSpecialUseService(config);
		const messageService = new MessageService(config);
		const messageFlagService = new MessageFlagService(config);
		const threadMessageService = new ThreadMessageService(config);
		const envelopeService = new EnvelopeService(config);

		// Queue services (SQS_QUEUE_URL required for write operations)
		const sqsQueueUrl = env.SQS_QUEUE_URL;

		client = {
			// ElectroDB services (reads)
			account: accountService,
			mailbox: mailboxService,
			mailboxSpecialUse: mailboxSpecialUseService,
			message: messageService,
			messageFlag: messageFlagService,
			threadMessage: threadMessageService,
			envelope: envelopeService,

			// Queue services (writes with IMAP sync)
			flagQueue: new FlagQueueService({
				messageFlagService,
				messageService,
				threadMessageService,
				sqsQueueUrl,
				logger,
			}),
			mailboxQueue: new MailboxQueueService({
				mailboxService,
				sqsQueueUrl,
				logger,
			}),
			messageMove: new MessageMoveService({
				messageService,
				mailboxService,
				mailboxSpecialUseService,
				threadMessageService,
				sqsQueueUrl,
				logger,
			}),
		};
	}

	return client;
};
