import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MessageItem, OutboxMessageItem } from "@remit/data-ports";
import { noopLogger } from "@remit/logger";
import {
	type EngagementCounterDeps,
	writeEngagementCounters,
} from "./engagement-counters.js";

const tenant = { accountConfigId: "cfg-1", accountId: "acc-1" };

const reply = (overrides: Partial<OutboxMessageItem>): OutboxMessageItem =>
	({
		outboxMessageId: "obx-1",
		accountId: "acc-1",
		accountConfigId: "cfg-1",
		fromAddress: "alice@example.com",
		toAddresses: ["bob@example.com"],
		messageIdValue: "msg-1@example.com",
		status: "sent",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}) as OutboxMessageItem;

const parent = { messageId: "msg-parent" } as MessageItem;

const recordingDeps = (
	parentSender: string,
): { deps: EngagementCounterDeps; replies: string[]; lookups: string[] } => {
	const replies: string[] = [];
	const lookups: string[] = [];
	return {
		replies,
		lookups,
		deps: {
			resolveAddressId: (accountConfigId, email) =>
				`addr-${accountConfigId}-${email}`,
			incrementOutboundCount: async () => {},
			incrementReplyCount: async (_accountConfigId, addressId) => {
				replies.push(addressId);
			},
			findMessageByHeader: async (accountId) => {
				lookups.push(accountId);
				return parent;
			},
			getEnvelopeFromEmail: async () => parentSender,
		},
	};
};

describe("writeEngagementCounters reply targets", () => {
	it("increments replyCount when In-Reply-To resolves to a recipient", async () => {
		const { deps, replies } = recordingDeps("bob@example.com");

		await writeEngagementCounters(
			reply({ inReplyTo: "parent-msg@example.com" }),
			tenant,
			deps,
			noopLogger,
		);

		assert.deepEqual(replies, ["addr-cfg-1-bob@example.com"]);
	});

	it("does not increment replyCount when the resolved sender is not a recipient", async () => {
		const { deps, replies } = recordingDeps("stranger@example.com");

		await writeEngagementCounters(
			reply({ inReplyTo: "parent-msg@example.com" }),
			tenant,
			deps,
			noopLogger,
		);

		assert.deepEqual(replies, []);
	});

	it("collapses duplicate replyCount increments via the resolved Address", async () => {
		const { deps, replies } = recordingDeps("bob@example.com");

		await writeEngagementCounters(
			reply({
				inReplyTo: "parent-msg@example.com",
				references: ["root-msg@example.com", "parent-msg@example.com"],
			}),
			tenant,
			deps,
			noopLogger,
		);

		assert.equal(replies.length, 1);
	});

	it("looks the parent up by accountId, never by accountConfigId", async () => {
		const { deps, lookups } = recordingDeps("bob@example.com");

		await writeEngagementCounters(
			reply({ inReplyTo: "parent-msg@example.com" }),
			tenant,
			deps,
			noopLogger,
		);

		assert.ok(lookups.length > 0);
		assert.ok(lookups.every((id) => id === "acc-1"));
	});
});
