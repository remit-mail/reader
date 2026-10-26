import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IAccountRepository } from "@remit/data-ports";
import type { IImapConnection } from "@remit/mailbox-service";
import type { SecretsService } from "@remit/secrets-service";
import type { StorageService } from "@remit/storage-service";
import {
	type ConnectionScopeFactory,
	createRemitCore,
	type RemitClientRepositories,
} from "./create-remit-client.js";

const account = {} as unknown as IAccountRepository;
const secrets = {} as unknown as SecretsService;
const connection = {} as unknown as IImapConnection;

const recordingFactory = (
	built: { account: IAccountRepository; secrets: SecretsService }[],
	opened: string[],
): ConnectionScopeFactory => {
	return (accountService, secretsService) => {
		built.push({ account: accountService, secrets: secretsService });
		return async (accountId) => {
			opened.push(accountId);
			return {
				getConnection: async () => connection,
				disconnect: async () => {},
			};
		};
	};
};

describe("createRemitCore connection scope", () => {
	it("opens the read-path IMAP connection through the scope factory the host injects", async () => {
		const built: { account: IAccountRepository; secrets: SecretsService }[] =
			[];
		const opened: string[] = [];

		const core = createRemitCore({
			repositories: { account } as unknown as RemitClientRepositories,
			storage: {} as unknown as StorageService,
			secrets,
			connectionScope: recordingFactory(built, opened),
		});
		const scope = await core.createConnectionScope("acc-1");

		assert.equal(await scope.getConnection(), connection);
		assert.deepEqual(opened, ["acc-1"]);
		assert.equal(built.length, 1);
		assert.equal(built[0]?.account, account);
		assert.equal(built[0]?.secrets, secrets);
	});
});
