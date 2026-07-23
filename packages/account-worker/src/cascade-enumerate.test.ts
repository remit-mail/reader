import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageDescription } from "@remit/data-ports";
import type { Logger } from "@remit/logger-lambda";
import {
	type CascadeEntity,
	type CascadeServices,
	collectMessageChildEntities,
	enumerateCascadeEntities,
} from "./cascade.js";

const noopLog = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	fatal: () => {},
	trace: () => {},
	child: () => noopLog,
} as unknown as Logger;

const messageWithChildren = {
	messageFlag: [{ messageFlagId: "flag-1" }],
	envelope: [{ envelopeId: "env-1" }],
	messageReference: [{ messageReferenceId: "ref-1" }],
	envelopeAddress: [{ envelopeAddressId: "ea-1" }],
	bodyPart: [{ bodyPartId: "bp-1" }],
	bodyPartParameter: [{ bodyPartParameterId: "bpp-1" }],
	rawMessageStorage: [{ rawStorageId: "rms-1" }],
	bodyPartStorage: [{ bodyPartStorageId: "bps-1" }],
	bodyPartContent: [{ bodyPartContentId: "bpc-1" }],
} as unknown as MessageDescription;

describe("collectMessageChildEntities", () => {
	it("expands the nine child entities of one message", () => {
		const entities: CascadeEntity[] = [];
		collectMessageChildEntities(entities, messageWithChildren);

		const byType = entities.map((e) => e.entityType);
		assert.deepEqual(byType, [
			"MessageFlag",
			"Envelope",
			"MessageReference",
			"EnvelopeAddress",
			"BodyPart",
			"BodyPartParameter",
			"RawMessageStorage",
			"BodyPartStorage",
			"BodyPartContent",
		]);
		assert.equal(
			entities.find((e) => e.entityType === "BodyPartContent")?.key
				.bodyPartContentId,
			"bpc-1",
		);
	});

	it("appends nothing when every child list is empty", () => {
		const entities: CascadeEntity[] = [];
		collectMessageChildEntities(entities, {
			messageFlag: [],
			envelope: [],
			messageReference: [],
			envelopeAddress: [],
			bodyPart: [],
			bodyPartParameter: [],
			rawMessageStorage: [],
			bodyPartStorage: [],
			bodyPartContent: [],
		} as unknown as MessageDescription);
		assert.equal(entities.length, 0);
	});
});

const fullServices = (): CascadeServices =>
	({
		accountConfigService: {
			describe: async () => ({
				account: [{ accountId: "acc-1" }],
				address: [{ addressId: "addr-1" }],
			}),
		},
		accountService: {
			describe: async () => ({ mailbox: [{ mailboxId: "mbx-1" }] }),
		},
		messageService: {
			listAllByMailbox: async () => [{ messageId: "msg-1" }],
			describe: async () => messageWithChildren,
		},
		outboxMessageService: {
			listByAccount: async () => ({ items: [{ outboxMessageId: "out-1" }] }),
		},
		mailboxLockService: {
			listByAccount: async () => [{ mailboxId: "mbx-1", eventName: "expunge" }],
		},
		messagePlacementMoveService: {
			listByAccountId: async () => [{ messageId: "msg-1" }],
		},
		messageFlagPushService: {
			listByAccountId: async () => [{ messageId: "msg-1", flagName: "\\Seen" }],
		},
		threadMessageService: {
			listAllByAccount: async () => [{ threadMessageId: "tm-1" }],
		},
		accountSettingService: {
			listByAccountConfig: async () => [{ accountSettingId: "set-1" }],
		},
		filterService: {
			listByAccountConfig: async () => [
				{ filterId: "flt-1", hasAnchor: true },
				{ filterId: "flt-2", hasAnchor: false },
			],
		},
		filterAnchorService: {
			get: async () => ({ filterId: "flt-1" }),
		},
		labelService: {
			listByAccountConfig: async () => [{ labelId: "lbl-1" }],
		},
		messageLabelService: {
			listByLabelId: async () => [{ messageLabelId: "ml-1" }],
		},
	}) as unknown as CascadeServices;

describe("enumerateCascadeEntities", () => {
	it("walks the whole account tree into a flat cascade plan", async () => {
		const { entities, messageIds } = await enumerateCascadeEntities(
			"cfg-1",
			fullServices(),
			noopLog,
		);

		assert.deepEqual(messageIds, ["msg-1"]);

		const types = entities.map((e) => e.entityType);
		for (const expected of [
			"Account",
			"Mailbox",
			"Message",
			"MessageFlag",
			"BodyPartContent",
			"OutboxMessage",
			"MailboxLock",
			"MessagePlacementMove",
			"MessageFlagPush",
			"ThreadMessage",
			"AccountSetting",
			"Filter",
			"FilterAnchor",
			"Label",
			"MessageLabel",
			"Address",
			"AccountConfig",
		]) {
			assert.ok(types.includes(expected), `missing ${expected}`);
		}

		assert.equal(types[types.length - 1], "AccountConfig");
	});

	it("emits a Filter without a FilterAnchor when the filter has no anchor", async () => {
		const services = fullServices();
		services.filterService.listByAccountConfig = async () =>
			[{ filterId: "flt-2", hasAnchor: false }] as never;

		const { entities } = await enumerateCascadeEntities(
			"cfg-1",
			services,
			noopLog,
		);

		assert.equal(entities.filter((e) => e.entityType === "Filter").length, 1);
		assert.equal(
			entities.filter((e) => e.entityType === "FilterAnchor").length,
			0,
		);
	});

	it("skips the FilterAnchor when the anchor lookup returns null", async () => {
		const services = fullServices();
		services.filterAnchorService.get = async () => null as never;

		const { entities } = await enumerateCascadeEntities(
			"cfg-1",
			services,
			noopLog,
		);

		assert.equal(
			entities.filter((e) => e.entityType === "FilterAnchor").length,
			0,
		);
	});

	it("yields only the AccountConfig row for an empty tenant", async () => {
		const services = fullServices();
		services.accountConfigService.describe = async () =>
			({ account: [], address: [] }) as never;
		services.threadMessageService.listAllByAccount = async () => [];
		services.accountSettingService.listByAccountConfig = async () => [];
		services.filterService.listByAccountConfig = async () => [];
		services.labelService.listByAccountConfig = async () => [];

		const { entities, messageIds } = await enumerateCascadeEntities(
			"cfg-empty",
			services,
			noopLog,
		);

		assert.equal(messageIds.length, 0);
		assert.deepEqual(
			entities.map((e) => e.entityType),
			["AccountConfig"],
		);
	});
});
