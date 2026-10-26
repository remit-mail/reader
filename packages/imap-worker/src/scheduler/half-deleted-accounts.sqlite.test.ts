import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { finishHalfDeletedAccounts } from "@remit/backend/account-deletion";
import type { RemitClient } from "@remit/backend/client";
import { importConfig } from "@remit/config-transfer";
import type { AccountItem } from "@remit/data-ports";
import {
	failingQueue,
	type RecordingQueue,
	recordingQueue,
} from "@remit/data-ports/recording-queue";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import { noopLogger } from "@remit/logger";
import { openStore } from "../test-helpers/test-world.js";

let store: Awaited<ReturnType<typeof openStore>>;
let client: RemitClient;

before(async () => {
	store = await openStore();
	client = store.client;
});

after(() => store.close());

const storedId = (): string => randomBytes(13).toString("hex").slice(0, 25);

const configDocument = (accountId: string, email: string) => ({
	kind: "reader.config",
	schemaVersion: 1,
	generator: {
		app: "reader",
		version: "v0.1.0",
		exportedAt: "2026-08-27T09:15:00+02:00",
	},
	provenance: { accountConfigId: storedId(), instance: "reader.example.com" },
	accountConfig: { name: "Imported" },
	accounts: [
		{
			accountId,
			email,
			username: email,
			authType: "password",
			credentials: { required: "password" },
			isActive: true,
			imap: { host: "imap.example.com", port: 993, tls: true, startTls: false },
			smtp: {
				enabled: false,
				host: "",
				port: 587,
				tls: false,
				startTls: false,
				username: "",
			},
			displayName: "",
			muted: null,
			composeLanguages: [],
			signature: { plainText: "", html: "" },
			folderRoles: [],
			folderOverrides: [],
			pinnedFolders: [],
		},
	],
	labels: [],
	filters: [],
	addressFlags: [],
});

const seedAccount = (
	accountConfigId: string,
	name: string,
	extra: { deletedAt?: number } = {},
): Promise<AccountItem> =>
	client.account.create({
		accountConfigId,
		username: `${name}@example.com`,
		email: `${name}@example.com`,
		authType: AccountAuthType.Password,
		passwordHash: '{"ciphertext":"x"}',
		imapHost: "imap.example.com",
		imapPort: 993,
		imapTls: true,
		imapStartTls: false,
		isActive: true,
		connectionState: ConnectionState.Authenticated,
		...extra,
	});

const importAccount = async (email: string): Promise<AccountItem> => {
	const accountConfigId = storedId();
	const accountId = storedId();
	const outcome = await importConfig(
		{
			repositories: client,
			appointFolderRole: async () => {},
		},
		{
			accountConfigId,
			document: configDocument(accountId, email),
			mode: "apply",
			onExisting: "abort",
		},
	);
	assert.equal(outcome.outcome, "report");
	return client.account.get(accountId);
};

const heal = (queue: RecordingQueue) =>
	finishHalfDeletedAccounts({
		account: client.account,
		configImport: client.configImport,
		queue,
		log: noopLogger,
	});

describe("finishing an account deleted before #1384 on scheduler start", () => {
	let halfDeleted: AccountItem;
	let live: AccountItem;
	let deleted: AccountItem;
	let imported: AccountItem;

	beforeEach(async () => {
		const accountConfigId = storedId();
		live = await seedAccount(accountConfigId, `live-${storedId()}`);
		halfDeleted = await seedAccount(accountConfigId, `gone-${storedId()}`);
		await client.account.update(halfDeleted.accountId, { isActive: false });
		deleted = await seedAccount(accountConfigId, `deleted-${storedId()}`, {
			deletedAt: 1_700_000_000_000,
		});
		await client.account.update(deleted.accountId, { isActive: false });
		imported = await importAccount(`imported-${storedId()}@example.com`);
	});

	const allAccounts = () =>
		client.account.get([
			halfDeleted.accountId,
			live.accountId,
			deleted.accountId,
			imported.accountId,
		]);

	it("tombstones it and asks for the same purge a delete asks for", async () => {
		const queue = recordingQueue();

		await heal(queue);

		const purges = queue.sent.map((message) => message.body);
		assert.ok(
			purges.some(
				(body) =>
					body.type === "AccountDataPurge" &&
					body.accountId === halfDeleted.accountId &&
					body.accountConfigId === halfDeleted.accountConfigId,
			),
		);
		const byId = new Map(
			(await allAccounts()).map((account) => [account.accountId, account]),
		);
		assert.ok(byId.get(halfDeleted.accountId)?.deletedAt);
		assert.equal(byId.get(live.accountId)?.deletedAt, undefined);
		assert.equal(byId.get(imported.accountId)?.deletedAt, undefined);
		assert.equal(byId.get(deleted.accountId)?.deletedAt, 1_700_000_000_000);
		assert.ok(
			!purges.some((body) =>
				[live.accountId, imported.accountId, deleted.accountId].includes(
					String(body.accountId),
				),
			),
		);
	});

	it("does nothing for it on the next start", async () => {
		await heal(recordingQueue());
		const queue = recordingQueue();

		await heal(queue);

		assert.ok(
			!queue.sent.some(
				(message) => message.body.accountId === halfDeleted.accountId,
			),
		);
	});

	it("fails the start and leaves it to be found again when the purge cannot be asked for", async () => {
		await assert.rejects(
			heal(failingQueue(new Error("queue unreachable"))),
			/queue unreachable/,
		);

		const after = await client.account.get(halfDeleted.accountId);
		assert.equal(after.deletedAt, undefined);
	});
});
