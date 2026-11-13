import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import { AccountAuthType, ConnectionState } from "@remit/domain-enums";
import { MessageMoveService } from "./message-move.js";
import { moveMessagesTo } from "./move-messages.js";
import {
	openStore,
	type Store,
	seedAccount,
	seedMailbox,
	seedMessage,
} from "./test-helpers/test-store.js";

let store: Store;

beforeEach(async () => {
	store = await openStore();
});

afterEach(() => store.close());

const depsOf = (current: Store) => ({
	...current,
	messageMove: new MessageMoveService({
		messageService: current.message,
		mailboxService: current.mailbox,
		mailboxSpecialUseService: current.mailboxSpecialUse,
		threadMessageService: current.threadMessage,
		addressService: current.address,
		queue: recordingQueue().fifo,
	}),
});

describe("moveMessagesTo a label", () => {
	it("files each account's messages into that account's label folder", async () => {
		const first = await seedAccount(store);
		const second = await store.account.create({
			accountConfigId: first.accountConfigId,
			username: "me-too@example.com",
			email: "me-too@example.com",
			authType: AccountAuthType.Password,
			passwordHash: '{"ciphertext":"x"}',
			imapHost: "imap.example.com",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			isActive: true,
			connectionState: ConnectionState.Authenticated,
		});
		const label = await store.label.create({
			accountConfigId: first.accountConfigId,
			name: "Promotions",
		});
		const folders = new Map<string, string>();
		const messages: string[] = [];
		for (const account of [first, second]) {
			const inbox = await seedMailbox(store, account, "INBOX");
			const labelFolder = await seedMailbox(store, account, "remit/Promotions");
			await store.labelMailbox.put({
				labelId: label.labelId,
				accountId: account.accountId,
				mailboxId: labelFolder.mailboxId,
			});
			const { message } = await seedMessage(store, account, inbox, 1);
			folders.set(message.messageId, labelFolder.mailboxId);
			messages.push(message.messageId);
		}

		const moved = await moveMessagesTo(
			depsOf(store),
			first.accountConfigId,
			messages,
			{ labelId: label.labelId },
		);

		assert.equal(moved.ok, true);
		for (const messageId of messages) {
			const row = await store.message.get(messageId);
			assert.equal(row.mailboxId, folders.get(messageId));
			const labels = await store.messageLabel.listByMessageId(messageId);
			assert.deepEqual(
				labels.map((applied) => applied.labelId),
				[label.labelId],
			);
		}
	});
});
