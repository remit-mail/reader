import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageDescription } from "@remit/data-ports";
import { noopLogger } from "@remit/logger-lambda/noop-logger";
import {
	type CascadeEntity,
	type CascadeServices,
	collectMessageChildEntities,
	enumerateCascadeEntities,
} from "./cascade.js";

const messageWithChildren = {
	messageFlag: [{ messageFlagId: "flag-1" }],
	envelope: [{ envelopeId: "env-1" }],
	messageReference: [{ messageReferenceId: "ref-1" }],
	envelopeAddress: [{ envelopeAddressId: "ea-1" }],
	bodyPart: [{ bodyPartId: "bp-1" }],
	bodyPartParameter: [{ bodyPartParameterId: "bpp-1" }],
	rawMessageStorage: [{ rawStorageId: "rms-1" }],
	bodyPartStorage: [{ bodyPartStorageId: "bps-1" }],
} as unknown as MessageDescription;

describe("collectMessageChildEntities", () => {
	it("expands the eight child entities of one message", () => {
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
		]);
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
			listByAccountConfig: async () => [{ filterId: "flt-1" }],
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
			noopLogger,
		);

		assert.deepEqual(messageIds, ["msg-1"]);

		const types = entities.map((e) => e.entityType);
		for (const expected of [
			"Account",
			"Mailbox",
			"Message",
			"MessageFlag",
			"OutboxMessage",
			"MailboxLock",
			"MessagePlacementMove",
			"MessageFlagPush",
			"ThreadMessage",
			"AccountSetting",
			"Filter",
			"Label",
			"MessageLabel",
			"Address",
			"AccountConfig",
		]) {
			assert.ok(types.includes(expected), `missing ${expected}`);
		}

		assert.equal(types[types.length - 1], "AccountConfig");
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
			noopLogger,
		);

		assert.equal(messageIds.length, 0);
		assert.deepEqual(
			entities.map((e) => e.entityType),
			["AccountConfig"],
		);
	});
});
