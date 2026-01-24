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
import { env } from "expect-env";

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
	account: AccountService;
	mailbox: MailboxService;
	mailboxSpecialUse: MailboxSpecialUseService;
	message: MessageService;
	messageFlag: MessageFlagService;
	threadMessage: ThreadMessageService;
	envelope: EnvelopeService;
}

let client: RemitClient | null = null;

export const getClient = (): RemitClient => {
	if (!client) {
		const documentClient = getDocumentClient();
		const table = env.DYNAMODB_TABLE_NAME;
		const salt = process.env.DYNAMODB_PAGINATION_SALT ?? "";
		const config = { client: documentClient, table, salt };

		client = {
			account: new AccountService(config),
			mailbox: new MailboxService(config),
			mailboxSpecialUse: new MailboxSpecialUseService(config),
			message: new MessageService(config),
			messageFlag: new MessageFlagService(config),
			threadMessage: new ThreadMessageService(config),
			envelope: new EnvelopeService(config),
		};
	}

	return client;
};
