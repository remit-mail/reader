import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { openStore, type World } from "../test-helpers/test-world.js";
import { buildAttachmentSweep } from "./attachment-sweep.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

/**
 * A draft holding one uploaded file, and one object under the same draft that
 * no attachment row names — what a browser leaves behind when it uploads and
 * the reservation lapses before it is completed.
 */
const arrange = async (w: World) => {
	const { outbox, attachmentId } = await w.draft(Buffer.from("q1,q2\n1,2\n"));
	await w.client.storage.storeOutboxAttachment({
		accountConfigId: w.account.accountConfigId,
		accountId: w.account.accountId,
		outboxMessageId: outbox.outboxMessageId,
		outboxAttachmentId: `orphan-${randomUUID()}`,
		content: Buffer.from("left behind"),
	});
	return { outboxMessageId: outbox.outboxMessageId, attachmentId };
};

const storedIds = async (w: World, outboxMessageId: string) =>
	(
		await w.client.storage.listOutboxAttachments(
			w.account.accountConfigId,
			w.account.accountId,
			outboxMessageId,
		)
	).map((item) => item.outboxAttachmentId);

describe("the outbox attachment sweep", () => {
	it("removes the objects no attachment row names and keeps the ones that are", async () => {
		const w = await store.world();
		const { outboxMessageId, attachmentId } = await arrange(w);

		await buildAttachmentSweep(w.client, w.log)(w.account);

		assert.deepEqual(await storedIds(w, outboxMessageId), [attachmentId]);
	});

	it("runs for every account on the hosted tick, due a sync or not", async () => {
		const first = await store.world();
		const firstDraft = await arrange(first);
		await first.client.account.update(first.account.accountId, {
			lastSyncAt: Date.now(),
		});
		const second = await store.world();
		const secondDraft = await arrange(second);

		const { handler } = await import("./handler.js");
		await handler(
			{ time: new Date().toISOString() } as never,
			{} as never,
			() => {},
		);

		assert.deepEqual(await storedIds(first, firstDraft.outboxMessageId), [
			firstDraft.attachmentId,
		]);
		assert.deepEqual(await storedIds(second, secondDraft.outboxMessageId), [
			secondDraft.attachmentId,
		]);
	});
});
