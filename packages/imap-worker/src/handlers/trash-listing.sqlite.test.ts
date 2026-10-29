import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MailboxSpecialUse } from "@remit/domain-enums";
import type { MessageDeleteEvent } from "../events.js";
import { openStore, type World } from "../test-helpers/test-world.js";
import { handleMessageDelete } from "./message-delete.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

const isMessageDelete = (
	body: Record<string, unknown>,
): body is MessageDeleteEvent & Record<string, unknown> =>
	body.type === "MESSAGE_DELETE";

const trashThroughReader = async (): Promise<{
	w: World;
	trashId: string;
	messageId: string;
}> => {
	const w = await store.world();
	const inbox = await w.folder("INBOX");
	const trash = await w.folder("Trash", {
		specialUse: MailboxSpecialUse.Trash,
	});
	const { messageId } = await w.message(inbox);
	await w.client.messageMove.deleteMessage(
		w.account.accountConfigId,
		messageId,
		w.account.accountId,
		{ toTrash: true },
	);
	const event = w.queued().find(isMessageDelete);
	assert.ok(event, "the delete enqueued a MESSAGE_DELETE");
	await handleMessageDelete(event, w.ctx(), 1);
	return { w, trashId: trash.mailboxId, messageId };
};

const listed = async (
	w: World,
	trashId: string,
	messageId: string,
): Promise<{ inTrash: boolean; inConversation: boolean }> => {
	const { accountConfigId } = w.account;
	const row = await w.client.threadMessage.getByMessageId(
		accountConfigId,
		messageId,
	);
	const trash = await w.client.threadMessage.listByMailbox(
		accountConfigId,
		trashId,
		{ excludeDeleted: true },
	);
	const conversation = await w.client.threadMessage.listByThread(
		row.threadId,
		accountConfigId,
		{ excludeDeleted: true },
	);
	return {
		inTrash: trash.items.some((item) => item.messageId === messageId),
		inConversation: conversation.items.some(
			(item) => item.messageId === messageId,
		),
	};
};

describe("mail trashed through reader (#1497)", () => {
	it("is listed in Trash and in its conversation", async () => {
		const { w, trashId, messageId } = await trashThroughReader();

		assert.deepEqual(await listed(w, trashId, messageId), {
			inTrash: true,
			inConversation: true,
		});
	});

	it("is hidden once Empty Trash marks it for expunge", async () => {
		const { w, trashId, messageId } = await trashThroughReader();

		await w.client.messageMove.emptyTrash(
			w.account.accountConfigId,
			w.account.accountId,
		);

		assert.deepEqual(await listed(w, trashId, messageId), {
			inTrash: false,
			inConversation: false,
		});
	});
});
