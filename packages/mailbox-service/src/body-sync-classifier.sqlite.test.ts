import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AccountItem, MailboxItem } from "@remit/data-ports";
import {
	type ClassificationDeploymentDefault,
	classificationUsageName,
	utcDateOf,
} from "@remit/data-ports/classification-presets";
import { deriveAddressId } from "@remit/data-ports/id";
import {
	AccountSettingName,
	ClassificationLabel,
	ClassificationPresetId,
	DisplayNameCorrespondence,
	MessageClassificationState,
	PlacementAction,
	PlacementConfidence,
} from "@remit/domain-enums";
import {
	createSecretsService,
	serializeEncryptedPayload,
} from "@remit/secrets-service";
import { BodySyncService } from "./body-sync.js";
import { CLASSIFIER_LABELS } from "./classifier/index.js";
import { PlacementMoveService } from "./placement-move.js";
import { SyncWarningService } from "./sync-warning.js";
import { eml, FakeImapServer } from "./test-helpers/fake-imap.js";
import {
	closedPortBaseUrl,
	type StubHttpServer,
	type StubReply,
	startStubHttpServer,
} from "./test-helpers/stub-http-server.js";
import {
	messageAtUid,
	openStore,
	type RecordingQueue,
	recordingQueue,
	type Store,
	seedAccount,
	seedMailbox,
	silentLog,
	syncFolder,
} from "./test-helpers/test-store.js";

const dataKey = randomBytes(32);
const secrets = createSecretsService({
	generateDataKey: async () => ({ plaintext: dataKey, encrypted: dataKey }),
	decryptDataKey: async () => dataKey,
});

const otherSecrets = createSecretsService({
	generateDataKey: async () => {
		const key = randomBytes(32);
		return { plaintext: key, encrypted: key };
	},
	decryptDataKey: async (encrypted) => encrypted,
});

const BROKEN_SETTINGS = [
	{
		name: "a preset id the code does not know",
		break: () =>
			upsert(AccountSettingName.ClassificationPresetId, {
				kind: "String",
				value: "RetiredPreset",
			}),
		warning:
			"Stored classification preset is unknown; using the built-in rules",
	},
	{
		name: "an api key that does not decrypt",
		break: async () =>
			upsert(AccountSettingName.ClassificationApiKey, {
				kind: "Map",
				value: {
					...serializeEncryptedPayload(await otherSecrets.encrypt("sk-other")),
				},
			}),
		warning:
			"Classification api key does not decrypt; using the built-in rules",
	},
];

const SHOP = eml(
	{
		From: "Shop <deals@shop.example>",
		Subject: "Half price this weekend",
		"List-Unsubscribe": "<https://shop.example/unsub>",
	},
	"Everything must go.",
);

const COLLEAGUE = eml(
	{ From: "Alex <alex@example.com>", Subject: "Contract due today" },
	"Can you sign the contract before five?",
);

const GMAIL_PERSON = eml(
	{
		From: "Jan de Vries <jan.devries@gmail.com>",
		Subject: "Dinner on Friday",
		"DKIM-Signature": "v=1; a=rsa-sha256; d=gmail.com; s=20230601; b=xxx",
	},
	"Shall we meet at seven?",
);

const ESP_NEWSLETTER = eml(
	{
		From: "Dutch Cycling Weekly <news@dutchcyclingweekly.nl>",
		Subject: "This week in cycling",
		"List-Unsubscribe": "<https://dutchcyclingweekly.nl/unsub>",
		"DKIM-Signature": "v=1; a=rsa-sha256; d=mcsv.net; s=k1; b=xxx",
	},
	"Read on https://dutchcyclingweekly.us1.list-manage.com/track/click?u=1",
);

interface World {
	store: Store;
	imap: FakeImapServer;
	queue: RecordingQueue;
	account: AccountItem;
	inbox: MailboxItem;
	junk: MailboxItem;
	provider: StubHttpServer;
	reply: StubReply;
	warnings: string[];
	classificationDefault: ClassificationDeploymentDefault;
}

let world: World;

const decision = (scores: Array<[string, number]>): StubReply => {
	const probabilities = Object.fromEntries(
		CLASSIFIER_LABELS.map((label) => [label, 0]),
	);
	for (const [label, probability] of scores) probabilities[label] = probability;
	const [top] = [...scores].sort((a, b) => b[1] - a[1]);
	return {
		status: 200,
		body: JSON.stringify({
			model: "jev-test",
			answers: {
				label: {
					type: "choice",
					choice: top[0],
					confidence: top[1],
					probabilities,
				},
			},
		}),
	};
};

beforeEach(async () => {
	const store = await openStore();
	const account = await seedAccount(store);
	const imap = new FakeImapServer();
	for (const path of ["INBOX", "Junk"]) imap.addFolder(path);
	const inbox = await seedMailbox(store, account, "INBOX");
	await store.mailbox.update(account.accountId, inbox.mailboxId, {
		initialSyncCompletedAt: 1,
	});
	world = {
		store,
		imap,
		queue: recordingQueue(),
		account,
		inbox,
		junk: await seedMailbox(store, account, "Junk", { specialUse: "Junk" }),
		provider: await startStubHttpServer(() => world.reply),
		reply: { status: 500, body: "{}" },
		warnings: [],
		classificationDefault: { state: "None" },
	};
});

afterEach(async () => {
	await world.provider.close();
	await world.store.close();
});

const upsert = (
	name: string,
	value: Parameters<Store["accountSetting"]["upsert"]>[0]["value"],
) =>
	world.store.accountSetting.upsert({
		accountConfigId: world.account.accountConfigId,
		name,
		value,
	});

const saveProvider = async (
	baseUrl: string = world.provider.baseUrl,
	enabled = true,
): Promise<void> => {
	await upsert(AccountSettingName.ClassificationApiKey, {
		kind: "Map",
		value: {
			...serializeEncryptedPayload(await secrets.encrypt("sk-test-key")),
		},
	});
	await upsert(AccountSettingName.ClassificationModel, {
		kind: "String",
		value: "jev-test",
	});
	await upsert(AccountSettingName.ClassificationBaseUrl, {
		kind: "String",
		value: baseUrl,
	});
	await upsert(AccountSettingName.ClassificationPresetId, {
		kind: "String",
		value: ClassificationPresetId.Jev,
	});
	await upsert(AccountSettingName.ClassificationEnabled, {
		kind: "Boolean",
		value: enabled,
	});
};

const bodySync = (classifier = true): BodySyncService => {
	const { store } = world;
	const placementMoveService = new PlacementMoveService({
		messageService: store.message,
		threadMessageService: store.threadMessage,
		markerService: store.placementMove,
		addressService: store.address,
		mailboxSpecialUseService: store.mailboxSpecialUse,
		mailboxService: store.mailbox,
		queue: world.queue,
	});
	return new BodySyncService(
		store.message,
		store.storage(),
		store.threadMessage,
		store.address,
		store.envelope,
		new SyncWarningService(store.syncWarning),
		silentLog,
		{ mailboxSpecialUseService: store.mailboxSpecialUse, placementMoveService },
		undefined,
		undefined,
		undefined,
		undefined,
		classifier
			? {
					accountSetting: store.accountSetting,
					accountConfig: store.accountConfig,
					classificationDefault: world.classificationDefault,
					secrets,
					labelService: store.label,
					messageLabelService: store.messageLabel,
					logger: { warn: (_obj, msg) => world.warnings.push(msg) },
				}
			: undefined,
	);
};

const arrive = async (
	raw: Buffer,
	internalDate: Date = new Date(Date.now() + 60_000),
): Promise<string> => {
	const uid = world.imap.deliver(world.inbox.fullPath, raw, { internalDate });
	await syncFolder(world.store, world.account, world.inbox, world.imap);
	return (await messageAtUid(world.store, world.inbox, uid)).messageId;
};

const sync = async (service: BodySyncService, messageIds: string[]) =>
	service.syncBodies(
		messageIds,
		world.account.accountId,
		world.account.accountConfigId,
		{
			mailboxId: world.inbox.mailboxId,
			fullPath: world.inbox.fullPath,
			placement: "inbox",
			uidValidity: world.inbox.uidValidity,
			initialSyncCompletedAt: (
				await world.store.mailbox.get(
					world.account.accountId,
					world.inbox.mailboxId,
				)
			).initialSyncCompletedAt,
		},
		async () => world.imap.connection(),
		{ force: false, concurrency: 1, bytesInFlight: 64 * 1024 * 1024 },
	);

const builtInCategory = async (raw: Buffer) => {
	const messageId = await arrive(raw);
	await sync(bodySync(false), [messageId]);
	return (await world.store.message.get(messageId)).category;
};

const labelNames = async (messageId: string): Promise<string[]> => {
	const applied = await world.store.messageLabel.listByMessageId(messageId);
	const names: string[] = [];
	for (const row of applied) {
		const label = await world.store.label.get(
			world.account.accountConfigId,
			row.labelId,
		);
		names.push(label.name);
	}
	return names.sort();
};

describe("body sync with a saved classification provider", () => {
	it("writes what the built-in rules write when no provider is saved", async () => {
		const expected = await builtInCategory(SHOP);
		const messageId = await arrive(SHOP);

		await sync(bodySync(), [messageId]);

		const row = await world.store.message.get(messageId);
		assert.equal(world.provider.requests.length, 0);
		assert.equal(row.category, expected);
		assert.equal(row.classificationState, MessageClassificationState.Examined);
	});

	it("makes no call while classification is switched off", async () => {
		await saveProvider(world.provider.baseUrl, false);
		const messageId = await arrive(SHOP);

		await sync(bodySync(), [messageId]);

		assert.equal(world.provider.requests.length, 0);
	});

	it("makes one call and sets the category in the one write", async () => {
		await saveProvider();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		const messageId = await arrive(COLLEAGUE);

		const result = await sync(bodySync(), [messageId]);

		assert.equal(result.syncedCount, 1);
		assert.equal(world.provider.requests.length, 1);
		const row = await world.store.message.get(messageId);
		assert.equal(row.category, "newsletter");
		assert.equal(row.classificationState, MessageClassificationState.Examined);
		const threads = await world.store.threadMessage.findAllByMessageId(
			world.account.accountConfigId,
			messageId,
		);
		assert.equal(threads[0].category, "newsletter");
		const sent = world.provider.requests[0].body;
		assert.match(sent, /Contract due today/);
		assert.match(sent, /sign the contract/);
	});

	it("skips mail that arrived before the provider was saved", async () => {
		await saveProvider();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		const messageId = await arrive(COLLEAGUE, new Date(Date.now() - 60_000));

		await sync(bodySync(), [messageId]);

		assert.equal(world.provider.requests.length, 0);
	});

	it("skips mail from an account that has not finished its first sync", async () => {
		await world.store.mailbox.update(
			world.account.accountId,
			world.inbox.mailboxId,
			{ initialSyncCompletedAt: 0 },
		);
		await saveProvider();
		const messageId = await arrive(COLLEAGUE);

		await sync(bodySync(), [messageId]);

		assert.equal(world.provider.requests.length, 0);
	});

	for (const broken of BROKEN_SETTINGS) {
		it(`stores every message with the built-in result under ${broken.name}`, async () => {
			const expected = await builtInCategory(SHOP);
			await saveProvider();
			await broken.break();
			world.reply = decision([[ClassificationLabel.Spam, 0.95]]);
			const messageIds = [await arrive(SHOP), await arrive(SHOP)];

			const result = await sync(bodySync(), messageIds);

			assert.equal(result.syncedCount, 2);
			assert.equal(result.failedCount, 0);
			assert.equal(world.provider.requests.length, 0);
			assert.deepEqual(world.warnings, [broken.warning]);
			for (const messageId of messageIds) {
				const row = await world.store.message.get(messageId);
				assert.equal(row.category, expected);
				assert.equal(
					row.classificationState,
					MessageClassificationState.Examined,
				);
				assert.equal(row.mailboxId, world.inbox.mailboxId);
			}
		});
	}

	it("stores the message with the built-in result while the provider is down", async () => {
		const expected = await builtInCategory(SHOP);
		await saveProvider(await closedPortBaseUrl());
		const messageId = await arrive(SHOP);

		const result = await sync(bodySync(), [messageId]);

		assert.equal(result.syncedCount, 1);
		assert.equal(result.failedCount, 0);
		const row = await world.store.message.get(messageId);
		assert.equal(row.category, expected);
		assert.equal(row.classificationState, MessageClassificationState.Examined);
		assert.ok(row.bodyStorageKey);
		assert.deepEqual(world.warnings, ["classification provider call failed"]);
	});

	it("makes no call for a message handled during a failure once the provider recovers", async () => {
		world.reply = { status: 503, body: "{}" };
		await saveProvider();
		const messageId = await arrive(SHOP);
		await sync(bodySync(), [messageId]);
		world.reply = decision([[ClassificationLabel.Spam, 0.95]]);

		const second = await sync(bodySync(), [messageId]);

		assert.equal(second.skippedCount, 1);
		assert.equal(world.provider.requests.length, 1);
	});

	it("moves a spam answer to Junk with the built-in category over marketing", async () => {
		const expected = await builtInCategory(SHOP);
		await saveProvider();
		world.reply = decision([
			[ClassificationLabel.Spam, 0.75],
			[ClassificationLabel.Marketing, 0.25],
		]);
		const messageId = await arrive(SHOP);

		await sync(bodySync(), [messageId]);

		const row = await world.store.message.get(messageId);
		assert.equal(row.mailboxId, world.junk.mailboxId);
		assert.equal(row.movedByRemit, true);
		assert.equal(row.category, expected);
	});

	it("keeps a never-spam sender out of Junk", async () => {
		await saveProvider();
		const email = "deals@shop.example";
		const addressId = deriveAddressId(world.account.accountConfigId, email);
		await world.store.address.upsertAddress({
			addressId,
			accountConfigId: world.account.accountConfigId,
			localPart: "deals",
			domain: "shop.example",
			normalizedEmail: email,
			normalizedCompound: email,
		});
		await world.store.address.updateAddress(
			world.account.accountConfigId,
			addressId,
			{ flags: { neverSpam: { value: true, setAt: 1 } } },
		);
		world.reply = decision([[ClassificationLabel.Spam, 0.95]]);
		const messageId = await arrive(SHOP);

		await sync(bodySync(), [messageId]);

		const row = await world.store.message.get(messageId);
		assert.equal(row.mailboxId, world.inbox.mailboxId);
	});

	it("applies the Priority label over a personal answer", async () => {
		await saveProvider();
		world.reply = decision([
			[ClassificationLabel.Priority, 0.72],
			[ClassificationLabel.Personal, 0.28],
		]);
		const messageId = await arrive(COLLEAGUE);

		await sync(bodySync(), [messageId]);

		assert.deepEqual(await labelNames(messageId), ["Priority"]);
	});

	it("lets the built-in result stand on a low-confidence answer", async () => {
		const expected = await builtInCategory(SHOP);
		await saveProvider();
		world.reply = decision([
			[ClassificationLabel.Spam, 0.6],
			[ClassificationLabel.Priority, 0.4],
		]);
		const messageId = await arrive(SHOP);

		await sync(bodySync(), [messageId]);

		const row = await world.store.message.get(messageId);
		assert.equal(world.provider.requests.length, 1);
		assert.equal(row.mailboxId, world.inbox.mailboxId);
		assert.equal(row.category, expected);
		assert.deepEqual(await labelNames(messageId), []);
	});
});

describe("body sync sender mismatch", () => {
	it("compares the sender of Inbox mail and leaves it where it is", async () => {
		const person = await arrive(GMAIL_PERSON);
		const newsletter = await arrive(ESP_NEWSLETTER);

		await sync(bodySync(false), [person, newsletter]);

		const personRow = await world.store.message.get(person);
		assert.equal(
			personRow.authenticity?.displayNameCorrespondence,
			DisplayNameCorrespondence.Unrelated,
		);
		assert.deepEqual(personRow.authenticity?.offDomainLinkDomains, []);
		const newsletterRow = await world.store.message.get(newsletter);
		assert.equal(
			newsletterRow.authenticity?.displayNameCorrespondence,
			undefined,
		);
		assert.deepEqual(newsletterRow.authenticity?.offDomainLinkDomains, [
			"list-manage.com",
		]);
		for (const row of [personRow, newsletterRow]) {
			assert.equal(row.mailboxId, world.inbox.mailboxId);
			assert.notEqual(row.movedByRemit, true);
		}
	});
});

const PROVIDER_SPAM_HEADERS = {
	"X-Spam-Status": "Yes, score=7.1",
	"X-Spam-Flag": "YES",
	"X-SpamExperts-Class": "spam",
	"X-HalOne-Spam-Probability": "0.98",
};

const JUNK_NEWSLETTER = eml(
	{
		From: "Dutch Cycling Weekly <news@dutchcyclingweekly.nl>",
		Subject: "This week in cycling",
		"List-Unsubscribe": "<https://dutchcyclingweekly.nl/unsub>",
		"Authentication-Results": "mx.example.com; dmarc=pass",
		...PROVIDER_SPAM_HEADERS,
	},
	"Read about the spring classics.",
);

const JUNK_SPOOF = eml(
	{
		From: "Support <support@evil-mimic.example>",
		Subject: "Verify your account",
		"Authentication-Results": "mx.example.com; dmarc=fail",
		"DKIM-Signature": "v=1; a=rsa-sha256; d=relay.example.net; s=sel; b=xxx",
		...PROVIDER_SPAM_HEADERS,
	},
	"Your account is locked.",
);

const NEWSLETTER_SENDER = "news@dutchcyclingweekly.nl";

const flagNewsletterSender = async (
	flags: Parameters<Store["address"]["updateAddress"]>[2]["flags"],
): Promise<void> => {
	const addressId = deriveAddressId(
		world.account.accountConfigId,
		NEWSLETTER_SENDER,
	);
	await world.store.address.upsertAddress({
		addressId,
		accountConfigId: world.account.accountConfigId,
		localPart: "news",
		domain: "dutchcyclingweekly.nl",
		normalizedEmail: NEWSLETTER_SENDER,
		normalizedCompound: NEWSLETTER_SENDER,
	});
	await world.store.address.updateAddress(
		world.account.accountConfigId,
		addressId,
		{ flags },
	);
};

const syncJunk = async (raw: Buffer, classifier = true): Promise<string> => {
	await world.store.mailbox.update(
		world.account.accountId,
		world.junk.mailboxId,
		{ initialSyncCompletedAt: 1 },
	);
	const uid = world.imap.deliver(world.junk.fullPath, raw, {
		internalDate: new Date(Date.now() + 60_000),
	});
	await syncFolder(world.store, world.account, world.junk, world.imap);
	const { messageId } = await messageAtUid(world.store, world.junk, uid);
	await bodySync(classifier).syncBodies(
		[messageId],
		world.account.accountId,
		world.account.accountConfigId,
		{
			mailboxId: world.junk.mailboxId,
			fullPath: world.junk.fullPath,
			placement: "junk",
			uidValidity: world.junk.uidValidity,
			initialSyncCompletedAt: 1,
		},
		async () => world.imap.connection(),
		{ force: false, concurrency: 1, bytesInFlight: 64 * 1024 * 1024 },
	);
	return messageId;
};

const assertMovedToInbox = async (messageId: string): Promise<void> => {
	const row = await world.store.message.get(messageId);
	assert.equal(row.mailboxId, world.inbox.mailboxId);
	assert.equal(row.movedByRemit, true);
	assert.equal(row.placementVerdict?.action, PlacementAction.MoveToInbox);
	assert.equal(row.placementVerdict?.fromPlacement, "junk");
};

const assertKeptInJunk = async (messageId: string): Promise<void> => {
	const row = await world.store.message.get(messageId);
	assert.equal(row.mailboxId, world.junk.mailboxId);
	assert.notEqual(row.movedByRemit, true);
	assert.equal(row.placementVerdict?.action, PlacementAction.MoveToJunk);
	assert.equal(row.placementVerdict?.fromPlacement, "junk");
};

describe("body sync judges a Junk arrival as an Inbox arrival", () => {
	it("moves an unknown newsletter the provider called spam to the Inbox", async () => {
		const messageId = await syncJunk(JUNK_NEWSLETTER, false);

		await assertMovedToInbox(messageId);
		const row = await world.store.message.get(messageId);
		assert.equal(row.placementVerdict?.confidence, PlacementConfidence.Unsure);
	});

	it("moves to the Inbox when the classifier times out", async () => {
		await saveProvider();
		world.reply = "Silent";

		const messageId = await syncJunk(JUNK_NEWSLETTER);

		assert.equal(world.provider.requests.length, 1);
		await assertMovedToInbox(messageId);
	});

	for (const trust of ["vip", "wellknown"] as const) {
		it(`moves a ${trust} sender to the Inbox over a classifier Junk answer`, async () => {
			await saveProvider();
			await flagNewsletterSender({ [trust]: { value: true, setAt: 1 } });
			world.reply = decision([[ClassificationLabel.Spam, 0.95]]);

			const messageId = await syncJunk(JUNK_NEWSLETTER);

			assert.equal(world.provider.requests.length, 1);
			await assertMovedToInbox(messageId);
		});
	}

	it("keeps a blocked sender in Junk", async () => {
		await flagNewsletterSender({ blocked: { value: true, setAt: 1 } });

		await assertKeptInJunk(await syncJunk(JUNK_NEWSLETTER, false));
	});

	it("keeps a DKIM mismatch with a DMARC fail in Junk", async () => {
		await assertKeptInJunk(await syncJunk(JUNK_SPOOF, false));
	});

	it("keeps a classifier Phishing answer in Junk and never shows it the provider's verdict", async () => {
		await saveProvider();
		world.reply = decision([[ClassificationLabel.Phishing, 0.95]]);

		const messageId = await syncJunk(JUNK_NEWSLETTER);

		await assertKeptInJunk(messageId);
		assert.equal(world.provider.requests.length, 1);
		assert.doesNotMatch(
			world.provider.requests[0].body,
			/x-spam|spamexperts|halone/i,
		);
	});
});

const today = (): string => utcDateOf(Date.now());

const yesterday = (): string => utcDateOf(Date.now() - 86_400_000);

const storeCalls = (accountId: string, date: string, calls: number) =>
	upsert(classificationUsageName(accountId), {
		kind: "DailyCount",
		value: { date, calls },
	});

const storedCalls = async (accountId: string) =>
	(
		await world.store.accountSetting.get(
			world.account.accountConfigId,
			classificationUsageName(accountId),
		)
	)?.value;

const syncOne = async (raw: Buffer): Promise<string> => {
	const messageId = await arrive(raw);
	await sync(bodySync(), [messageId]);
	return messageId;
};

describe("body sync under the daily classification limit", () => {
	it("classifies call 500 and gives call 501 the built-in result", async () => {
		const expected = await builtInCategory(COLLEAGUE);
		await saveProvider();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await storeCalls(world.account.accountId, today(), 499);

		const atLimit = await syncOne(COLLEAGUE);
		const overLimit = await syncOne(COLLEAGUE);

		assert.equal(world.provider.requests.length, 1);
		assert.equal(
			(await world.store.message.get(atLimit)).category,
			"newsletter",
		);
		const row = await world.store.message.get(overLimit);
		assert.equal(row.category, expected);
		assert.equal(row.classificationState, MessageClassificationState.Examined);
		assert.deepEqual(await storedCalls(world.account.accountId), {
			kind: "DailyCount",
			value: { date: today(), calls: 500 },
		});
	});

	it("keeps calling for an account while another sits at its limit", async () => {
		await saveProvider();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await storeCalls("1".repeat(25), today(), 500);

		const messageId = await syncOne(COLLEAGUE);

		assert.equal(world.provider.requests.length, 1);
		assert.equal(
			(await world.store.message.get(messageId)).category,
			"newsletter",
		);
	});

	it("resumes calls for new mail once the limit is raised, and leaves capped mail as it was", async () => {
		const expected = await builtInCategory(COLLEAGUE);
		await saveProvider();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await storeCalls(world.account.accountId, today(), 500);
		const capped = await syncOne(COLLEAGUE);
		assert.equal(world.provider.requests.length, 0);

		await upsert(AccountSettingName.ClassificationDailyLimit, {
			kind: "Number",
			value: 501,
		});
		const resumed = await syncOne(COLLEAGUE);
		const again = await sync(bodySync(), [capped]);

		assert.equal(world.provider.requests.length, 1);
		assert.equal(
			(await world.store.message.get(resumed)).category,
			"newsletter",
		);
		assert.equal(again.skippedCount, 1);
		assert.equal((await world.store.message.get(capped)).category, expected);
	});

	it("starts a new day at zero calls", async () => {
		await saveProvider();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await storeCalls(world.account.accountId, yesterday(), 500);

		const messageId = await syncOne(COLLEAGUE);

		assert.equal(world.provider.requests.length, 1);
		assert.equal(
			(await world.store.message.get(messageId)).category,
			"newsletter",
		);
		assert.deepEqual(await storedCalls(world.account.accountId), {
			kind: "DailyCount",
			value: { date: today(), calls: 1 },
		});
	});
});

const DEPLOYMENT_KEY = "sk-deployment-key";

const deployJev = (): void => {
	world.classificationDefault = {
		state: "Configured",
		presetId: ClassificationPresetId.Jev,
		model: "jev-deployment",
		baseUrl: world.provider.baseUrl,
		apiKey: DEPLOYMENT_KEY,
		enabled: true,
		dailyLimit: 500,
	};
};

const sentModel = (index = 0): unknown =>
	JSON.parse(world.provider.requests[index].body).model;

describe("body sync on the deployment classification default", () => {
	it("classifies new mail for an account config with no rows", async () => {
		deployJev();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);

		const messageId = await syncOne(COLLEAGUE);

		assert.equal(world.provider.requests.length, 1);
		assert.equal(
			world.provider.requests[0].headers.authorization,
			`Bearer ${DEPLOYMENT_KEY}`,
		);
		assert.equal(sentModel(), "jev-deployment");
		assert.equal(
			(await world.store.message.get(messageId)).category,
			"newsletter",
		);
	});

	it("skips mail that arrived before the account config was created", async () => {
		deployJev();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		const messageId = await arrive(COLLEAGUE, new Date(Date.now() - 60_000));

		await sync(bodySync(), [messageId]);

		assert.equal(world.provider.requests.length, 0);
	});

	it("sends a saved key over the deployment key", async () => {
		deployJev();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await upsert(AccountSettingName.ClassificationApiKey, {
			kind: "Map",
			value: {
				...serializeEncryptedPayload(await secrets.encrypt("sk-saved-key")),
			},
		});

		await syncOne(COLLEAGUE);

		assert.equal(
			world.provider.requests[0].headers.authorization,
			"Bearer sk-saved-key",
		);
	});

	it("sends a saved model over the deployment model", async () => {
		deployJev();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await upsert(AccountSettingName.ClassificationModel, {
			kind: "String",
			value: "jev-saved",
		});

		await syncOne(COLLEAGUE);

		assert.equal(sentModel(), "jev-saved");
	});

	it("stops at a saved daily limit below the deployment limit", async () => {
		deployJev();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await upsert(AccountSettingName.ClassificationDailyLimit, {
			kind: "Number",
			value: 1,
		});
		await storeCalls(world.account.accountId, today(), 1);

		await syncOne(COLLEAGUE);

		assert.equal(world.provider.requests.length, 0);
	});

	it("makes no call when the saved switch is off", async () => {
		deployJev();
		world.reply = decision([[ClassificationLabel.Newsletter, 0.9]]);
		await upsert(AccountSettingName.ClassificationEnabled, {
			kind: "Boolean",
			value: false,
		});

		await syncOne(COLLEAGUE);

		assert.equal(world.provider.requests.length, 0);
	});
});
