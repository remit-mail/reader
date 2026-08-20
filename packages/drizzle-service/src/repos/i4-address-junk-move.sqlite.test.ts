import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type Database from "better-sqlite3";
import { createTestDb, type TestDb } from "../test-db.js";
import { AddressRepo } from "./i4-address.js";

const CONFIG = "cfg-1";

describe("reconciling one message's addresses at the moment it moves", () => {
	let db: TestDb;
	let sqlite: Database.Database;
	let close: () => Promise<void>;
	let repo: AddressRepo;

	const mailbox = (mailboxId: string, specialUse: string | null): void => {
		sqlite
			.prepare(
				`INSERT INTO mailbox (
					mailbox_id, account_id, namespace_prefix, hierarchy_delimiter,
					full_path, uid_validity, uid_next, highest_modseq, message_count,
					unseen_count, deleted_count, total_size, last_sync_uid,
					high_water_mark_uid, last_message_sync_at, special_use,
					created_at, updated_at
				) VALUES (?, 'acc', '', '/', ?, 1, 1, '0', 0, 0, 0, 0, 0, 0, 0, ?, 0, 0)`,
			)
			.run(mailboxId, mailboxId, specialUse);
	};

	const message = (messageId: string, mailboxId: string): void => {
		sqlite
			.prepare(
				`INSERT INTO message (
					message_id, mailbox_id, uid, sequence_number, rfc822_size,
					internal_date, envelope_id, root_body_part_id, created_at, updated_at
				) VALUES (?, ?, 1, 1, 10, 0, 'env', 'body', 0, 0)`,
			)
			.run(messageId, mailboxId);
	};

	const sighting = (addressId: string, messageId: string): void => {
		sqlite
			.prepare(
				`INSERT INTO envelope_address (
					envelope_address_id, message_id, address_id, display_name,
					normalized_email, address_role, address_order, created_at, updated_at
				) VALUES (?, ?, ?, 'Name', ?, 'From', 0, 0, 0)`,
			)
			.run(
				`${addressId}-${messageId}`,
				messageId,
				addressId,
				`${addressId}@example.com`,
			);
	};

	const harvest = async (addressId: string) =>
		repo.upsertCorrespondentAddress({
			addressId,
			accountConfigId: CONFIG,
			displayName: "Name",
			localPart: addressId,
			domain: "example.com",
			normalizedEmail: `${addressId}@example.com`,
			normalizedCompound: `name ${addressId}@example.com`,
		});

	const moveTo = (messageId: string, mailboxId: string): void => {
		sqlite
			.prepare("UPDATE message SET mailbox_id = ? WHERE message_id = ?")
			.run(mailboxId, messageId);
	};

	const withheld = async (addressId: string): Promise<boolean> =>
		(await repo.getAddress(CONFIG, addressId)).flags?.junkOnly?.value === true;

	const suggested = async (term: string): Promise<string[]> =>
		(
			await repo.listByAccountConfig({
				accountConfigId: CONFIG,
				search: term,
			})
		).items.map((item) => item.addressId);

	before(async () => {
		({ db, sqlite, close } = await createTestDb());
		repo = new AddressRepo(db as never);
	});

	after(async () => {
		await close();
	});

	beforeEach(() => {
		for (const table of ["address", "envelope_address", "message", "mailbox"]) {
			sqlite.exec(`DELETE FROM ${table}`);
		}
		mailbox("inbox", null);
		mailbox("junk", '["Junk"]');
		mailbox("trash", '["Trash"]');
	});

	test("a message moved into Junk stops the sender being suggested", async () => {
		message("msg", "inbox");
		await harvest("spammer");
		sighting("spammer", "msg");
		assert.deepEqual(await suggested("spammer"), ["spammer"]);

		moveTo("msg", "junk");
		await repo.reconcileJunkOnlyForMessage("msg");

		assert.equal(await withheld("spammer"), true);
		assert.deepEqual(await suggested("spammer"), []);
	});

	test("a sender the account has written to survives the move", async () => {
		message("msg", "inbox");
		await harvest("client");
		sighting("client", "msg");
		await repo.incrementOutboundCount(CONFIG, "client", Date.now());

		moveTo("msg", "junk");
		await repo.reconcileJunkOnlyForMessage("msg");

		assert.equal(await withheld("client"), false);
	});

	test("a sender still on live mail survives the move", async () => {
		message("spam", "inbox");
		message("real", "inbox");
		await harvest("colleague");
		sighting("colleague", "spam");
		sighting("colleague", "real");

		moveTo("spam", "junk");
		await repo.reconcileJunkOnlyForMessage("spam");

		assert.equal(await withheld("colleague"), false);
	});

	test("a message rescued out of Junk offers the sender again", async () => {
		message("msg", "junk");
		await repo.upsertJunkAddress({
			addressId: "misfiled",
			accountConfigId: CONFIG,
			displayName: "Name",
			localPart: "misfiled",
			domain: "example.com",
			normalizedEmail: "misfiled@example.com",
			normalizedCompound: "name misfiled@example.com",
		});
		sighting("misfiled", "msg");
		assert.deepEqual(await suggested("misfiled"), []);

		moveTo("msg", "inbox");
		await repo.reconcileJunkOnlyForMessage("msg");

		assert.deepEqual(await suggested("misfiled"), ["misfiled"]);
	});

	test("a spam message moved to Trash keeps the sender withheld", async () => {
		message("msg", "junk");
		await repo.upsertJunkAddress({
			addressId: "spammer",
			accountConfigId: CONFIG,
			displayName: "Name",
			localPart: "spammer",
			domain: "example.com",
			normalizedEmail: "spammer@example.com",
			normalizedCompound: "name spammer@example.com",
		});
		sighting("spammer", "msg");

		moveTo("msg", "trash");
		await repo.reconcileJunkOnlyForMessage("msg");

		assert.equal(await withheld("spammer"), true);
	});

	test("touches no address the message does not carry", async () => {
		message("msg", "inbox");
		message("other", "junk");
		await harvest("bystander");
		sighting("bystander", "other");

		moveTo("msg", "junk");
		await repo.reconcileJunkOnlyForMessage("msg");

		assert.equal(await withheld("bystander"), false);
	});

	test("another client filing INBOX mail into Junk withholds the sender", async () => {
		message("msg", "inbox");
		await harvest("spammer");
		sighting("spammer", "msg");
		assert.deepEqual(await suggested("spammer"), ["spammer"]);

		await repo.withholdAddressesSeenInJunk("msg");

		assert.equal(await withheld("spammer"), true);
		assert.deepEqual(await suggested("spammer"), []);
	});

	test("a sender still on live mail survives a sighting in Junk", async () => {
		message("spam", "inbox");
		message("real", "inbox");
		await harvest("colleague");
		sighting("colleague", "spam");
		sighting("colleague", "real");

		await repo.withholdAddressesSeenInJunk("spam");

		assert.equal(await withheld("colleague"), false);
	});

	test("a sender the account has written to survives a sighting in Junk", async () => {
		message("msg", "inbox");
		await harvest("client");
		sighting("client", "msg");
		await repo.incrementOutboundCount(CONFIG, "client", Date.now());

		await repo.withholdAddressesSeenInJunk("msg");

		assert.equal(await withheld("client"), false);
	});

	test("a sighting in Junk touches no address the message does not carry", async () => {
		message("msg", "inbox");
		message("other", "inbox");
		await harvest("bystander");
		sighting("bystander", "other");

		await repo.withholdAddressesSeenInJunk("msg");

		assert.equal(await withheld("bystander"), false);
	});

	test("a second reconcile of the same move writes nothing new", async () => {
		message("msg", "inbox");
		await harvest("spammer");
		sighting("spammer", "msg");
		moveTo("msg", "junk");
		await repo.reconcileJunkOnlyForMessage("msg");
		const first = await repo.getAddress(CONFIG, "spammer");

		await repo.reconcileJunkOnlyForMessage("msg");

		assert.deepEqual(await repo.getAddress(CONFIG, "spammer"), first);
	});
});
