import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { OutboxMessageItem } from "@remit/data-ports";
import { MailboxSpecialUse, OutboxMessageStatus } from "@remit/domain-enums";
import type { AppendSentMessageEvent } from "../events.js";
import { openStore, type World } from "../test-helpers/world.js";
import { handleAppendSentMessage } from "./append-sent-message.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

interface Arranged {
	w: World;
	outbox: OutboxMessageItem;
	event: AppendSentMessageEvent;
}

/**
 * A message composed and sent through the service the API calls, then marked
 * sent the way the SMTP worker marks it once the relay accepted it.
 */
const arrange = async (
	options: { sentFolder?: boolean; attachment?: Buffer } = {},
): Promise<Arranged> => {
	const w = await store.world();
	await w.folder("INBOX");
	if (options.sentFolder !== false) {
		await w.folder("Sent", { specialUse: MailboxSpecialUse.Sent });
	}
	const { outbox: draft } = await w.draft(options.attachment);
	const outbox = await w.client.outboxQueue.send(
		w.account.accountConfigId,
		draft.outboxMessageId,
	);
	await w.client.outboxMessage.update(
		w.account.accountConfigId,
		outbox.outboxMessageId,
		{ status: OutboxMessageStatus.sent, sentAt: Date.now() },
	);
	return {
		w,
		outbox,
		event: {
			type: "APPEND_SENT_MESSAGE",
			eventId: `evt-${outbox.outboxMessageId}`,
			timestamp: Date.now(),
			accountId: w.account.accountId,
			outboxMessageId: outbox.outboxMessageId,
		} as AppendSentMessageEvent,
	};
};

const run = (a: Arranged, receiveCount = 1) =>
	handleAppendSentMessage(a.event, a.w.log, receiveCount, a.w.deps() as never);

const outboxRow = (a: Arranged) =>
	a.w.client.outboxMessage
		.get(a.w.account.accountConfigId, a.outbox.outboxMessageId)
		.catch(() => undefined);

describe("filing a sent message", () => {
	it("stores a seen copy under its own Message-ID in Sent and drops the outbox row", async () => {
		const a = await arrange();

		await run(a);

		const [copy] = a.w.imap.folder("Sent").messages;
		assert.equal(copy?.messageIdHeader, `<${a.outbox.messageIdValue}>`);
		assert.ok(copy?.flags.has("\\Seen"));
		assert.match(
			copy?.raw.toString("utf8") ?? "",
			/Subject: Quarterly numbers/,
		);
		assert.equal(await outboxRow(a), undefined);
	});

	// #679: the Sent copy carries the files the wire copy carried, and the row
	// was the only reference to them, so they go with it.
	it("files the copy with its attachment and removes the stored file", async () => {
		const a = await arrange({ attachment: Buffer.from("q1,q2\n1,2\n") });

		await run(a);

		const raw = a.w.imap.folder("Sent").messages[0]?.raw.toString("utf8") ?? "";
		assert.match(raw, /^Content-Type: multipart\/mixed;/m);
		assert.match(raw, /filename=numbers\.csv/);
		assert.deepEqual(
			await a.w.client.storage.listOutboxAttachments(
				a.w.account.accountConfigId,
				a.w.account.accountId,
				a.outbox.outboxMessageId,
			),
			[],
		);
	});

	it("settles the row as unfiled when the account has no Sent folder", async () => {
		const a = await arrange({ sentFolder: false });

		await run(a);

		assert.equal(a.w.imap.connections, 0);
		const row = await outboxRow(a);
		assert.equal(row?.status, OutboxMessageStatus.unfiled);
		assert.match(
			String(row?.lastError),
			/no folder appointed to the Sent role/,
		);
	});

	it("files nothing while the message has not been sent yet", async () => {
		const a = await arrange();
		await a.w.client.outboxMessage.update(
			a.w.account.accountConfigId,
			a.outbox.outboxMessageId,
			{ status: OutboxMessageStatus.queued },
		);

		await run(a);

		assert.deepEqual(a.w.imap.commands("APPEND"), []);
		assert.equal((await outboxRow(a))?.status, OutboxMessageStatus.queued);
	});

	it("keeps the row and redelivers a refused APPEND within the budget", async () => {
		const a = await arrange();
		a.w.imap.failNext.APPEND = new Error("Connection reset");

		await assert.rejects(run(a), /Connection reset/);

		assert.equal((await outboxRow(a))?.status, OutboxMessageStatus.sent);
	});

	it("settles the row as unfiled on the last attempt instead of dead-lettering it", async () => {
		const a = await arrange();
		a.w.imap.failNext.APPEND = new Error("Mailbox is full");

		await run(a, 3);

		const row = await outboxRow(a);
		assert.equal(row?.status, OutboxMessageStatus.unfiled);
		assert.match(String(row?.lastError), /Mailbox is full/);
	});

	// #858: a redelivery after the APPEND landed must not file a second copy.
	it("files nothing a second time when the copy was already recorded", async () => {
		const a = await arrange();
		await a.w.client.outboxMessage.update(
			a.w.account.accountConfigId,
			a.outbox.outboxMessageId,
			{ appendedUid: 41 },
		);

		await run(a);

		assert.deepEqual(a.w.imap.commands("APPEND"), []);
		assert.equal(await outboxRow(a), undefined);
	});

	it("acks an event whose outbox row is already gone", async () => {
		const a = await arrange();
		await a.w.client.outboxMessage.delete(
			a.w.account.accountConfigId,
			a.outbox.outboxMessageId,
		);

		await run(a);

		assert.equal(a.w.imap.connections, 0);
	});
});
