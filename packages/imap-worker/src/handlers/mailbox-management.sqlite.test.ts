import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { MailboxItem } from "@remit/data-ports";
import { MailboxSyncStatus } from "@remit/domain-enums";
import { imapError } from "@remit/mailbox-service/test-helpers/fake-imap";
import type { MailboxManagementEvent } from "../events.js";
import { openStore, type World } from "../test-helpers/test-world.js";
import { processMailboxManagement } from "./mailbox-management.js";

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

const lastEvent = (w: World, type: string): MailboxManagementEvent => {
	const event = w
		.queued()
		.filter((body) => body.type === type)
		.at(-1) as unknown as MailboxManagementEvent | undefined;
	assert.ok(event, `a ${type} was enqueued`);
	return event;
};

const run = (w: World, event: MailboxManagementEvent) =>
	processMailboxManagement(event, w.ctx());

const mailbox = (
	w: World,
	mailboxId: string,
): Promise<MailboxItem | undefined> =>
	w.client.mailbox
		.listAllByAccount(w.account.accountId)
		.then((rows) => rows.find((row) => row.mailboxId === mailboxId));

/** A folder created through the service the API calls, not yet on the server. */
const requestCreate = async (
	w: World,
	path: string,
	subscribe?: boolean,
): Promise<{ mailboxId: string; event: MailboxManagementEvent }> => {
	const created = await w.client.mailboxQueue.createMailbox(
		{
			accountId: w.account.accountId,
			namespacePrefix: "",
			hierarchyDelimiter: "/",
			fullPath: path,
			uidValidity: 0,
			uidNext: 0,
			highestModseq: "0",
			messageCount: 0,
			unseenCount: 0,
			deletedCount: 0,
			totalSize: 0,
			lastSyncUid: 0,
			highWaterMarkUid: 0,
			lastMessageSyncAt: 0,
		},
		w.account.accountId,
		subscribe,
	);
	assert.equal(created.outcome, "Created");
	if (created.outcome !== "Created") throw new Error("path taken");
	return {
		mailboxId: created.mailbox.mailboxId,
		event: lastEvent(w, "MAILBOX_CREATE"),
	};
};

describe("creating a folder", () => {
	it("creates it on the server and settles the row on the server's UIDVALIDITY", async () => {
		const w = await store.world();
		const { mailboxId, event } = await requestCreate(w, "Receipts");

		await run(w, event);

		assert.ok(w.imap.hasFolder("Receipts"));
		const row = await mailbox(w, mailboxId);
		assert.equal(row?.syncStatus, MailboxSyncStatus.synced);
		assert.equal(row?.uidValidity, w.imap.uidValidityOf("Receipts"));
	});

	it("subscribes only when the request asks for it", async () => {
		const w = await store.world();
		const quiet = await requestCreate(w, "Quiet");
		const loud = await requestCreate(w, "Loud", true);

		await run(w, quiet.event);
		await run(w, loud.event);

		assert.deepEqual(w.imap.commands("SUBSCRIBE"), ["SUBSCRIBE Loud"]);
	});

	it("settles a folder the server already has as created", async () => {
		const w = await store.world();
		const { mailboxId, event } = await requestCreate(w, "Receipts");
		w.imap.addFolder("Receipts", { uidValidity: 7 });

		await run(w, event);

		assert.equal(
			(await mailbox(w, mailboxId))?.syncStatus,
			MailboxSyncStatus.synced,
		);
	});

	it("marks the folder failed with the server's reason and acks a refused create", async () => {
		const w = await store.world();
		const { mailboxId, event } = await requestCreate(w, "Receipts");
		w.imap.failNext.CREATE = imapError("NOPERM", "Permission denied");

		await run(w, event);

		const row = await mailbox(w, mailboxId);
		assert.equal(row?.syncStatus, MailboxSyncStatus.failed);
		assert.equal(row?.syncFailureReason, "Permission denied");
	});

	it("marks the folder failed and redelivers when the create fails for another reason", async () => {
		const w = await store.world();
		const { mailboxId, event } = await requestCreate(w, "Receipts");
		w.imap.failNext.CREATE = new Error("Connection reset");

		await assert.rejects(run(w, event), /Connection reset/);

		assert.equal(
			(await mailbox(w, mailboxId))?.syncStatus,
			MailboxSyncStatus.failed,
		);
	});

	it("acks when the folder row was deleted before the create ran", async () => {
		const w = await store.world();
		const { mailboxId, event } = await requestCreate(w, "Receipts");
		await w.client.mailbox.delete(w.account.accountId, mailboxId);

		await run(w, event);
	});
});

describe("renaming a folder", () => {
	const arrange = async () => {
		const w = await store.world();
		const work = await w.folder("Work");
		const child = await w.folder("Work/Clients");
		const message = await w.message(child);
		await w.client.mailboxQueue.renameMailbox(
			work.mailboxId,
			"Projects",
			w.account.accountId,
		);
		return { w, work, child, message, event: lastEvent(w, "MAILBOX_RENAME") };
	};

	it("renames on the server and settles the folder and its children onto the new path", async () => {
		const { w, work, child, event } = await arrange();

		await run(w, event);

		assert.ok(w.imap.hasFolder("Projects/Clients"));
		assert.equal((await mailbox(w, work.mailboxId))?.fullPath, "Projects");
		const settledChild = await mailbox(w, child.mailboxId);
		assert.equal(settledChild?.fullPath, "Projects/Clients");
		assert.equal(settledChild?.syncStatus, MailboxSyncStatus.synced);
	});

	it("removes the folder, its children and their mail when the source is gone on the server", async () => {
		const { w, work, child, message, event } = await arrange();
		w.imap.removeFolder("Work");
		w.imap.removeFolder("Work/Clients");

		await run(w, event);

		assert.equal(await mailbox(w, work.mailboxId), undefined);
		assert.equal(await mailbox(w, child.mailboxId), undefined);
		assert.equal(await w.row(message.messageId), undefined);
	});

	it("keeps the confirmed path and acks a refused rename", async () => {
		const { w, work, event } = await arrange();
		w.imap.failNext.RENAME = imapError("NOPERM", "Permission denied");

		await run(w, event);

		const row = await mailbox(w, work.mailboxId);
		assert.equal(row?.fullPath, "Work");
		assert.equal(row?.syncStatus, MailboxSyncStatus.failed);
		assert.ok(w.imap.hasFolder("Work"));
	});

	it("issues no RENAME when a redelivery finds the rename already settled", async () => {
		const { w, event } = await arrange();
		await run(w, event);

		await run(w, event);

		assert.equal(w.imap.commands("RENAME").length, 1);
	});
});

describe("deleting a folder", () => {
	const arrange = async () => {
		const w = await store.world();
		const old = await w.folder("Old");
		const message = await w.message(old);
		await w.client.mailboxQueue.deleteMailbox(
			old.mailboxId,
			w.account.accountId,
		);
		return { w, old, message, event: lastEvent(w, "MAILBOX_DELETE") };
	};

	it("deletes it on the server and removes the folder and its mail", async () => {
		const { w, old, message, event } = await arrange();

		await run(w, event);

		assert.equal(w.imap.hasFolder("Old"), false);
		assert.equal(await mailbox(w, old.mailboxId), undefined);
		assert.equal(await w.row(message.messageId), undefined);
	});

	it("removes the folder and its mail when the server no longer has it", async () => {
		const { w, old, message, event } = await arrange();
		w.imap.removeFolder("Old");

		await run(w, event);

		assert.equal(await mailbox(w, old.mailboxId), undefined);
		assert.equal(await w.row(message.messageId), undefined);
	});

	it("marks the folder failed, keeps its mail and acks a refused delete", async () => {
		const { w, old, message, event } = await arrange();
		w.imap.failNext.DELETE = imapError("NOPERM", "Permission denied");

		await run(w, event);

		assert.equal(
			(await mailbox(w, old.mailboxId))?.syncStatus,
			MailboxSyncStatus.failed,
		);
		assert.ok(await w.row(message.messageId));
		assert.ok(w.imap.hasFolder("Old"));
	});

	it("issues no DELETE for a folder that is not being deleted", async () => {
		const w = await store.world();
		const kept = await w.folder("Kept");

		await run(w, {
			type: "MAILBOX_DELETE",
			eventId: "evt-stale",
			timestamp: Date.now(),
			accountId: w.account.accountId,
			mailboxId: kept.mailboxId,
			path: "Kept",
		} as MailboxManagementEvent);

		assert.deepEqual(w.imap.commands("DELETE"), []);
		assert.ok(await mailbox(w, kept.mailboxId));
	});
});
