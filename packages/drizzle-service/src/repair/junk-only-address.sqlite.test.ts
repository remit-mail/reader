import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import Database from "better-sqlite3";
import { shippedTableDdl } from "../test-shipped-sqlite-schema.js";
import {
	type JunkOnlyRepairClient,
	sweepJunkOnlyAddresses,
} from "./junk-only-address.js";

const DDL_TAG = "0000_happy_roland_deschain";

const clientOver = (sqlite: Database.Database): JunkOnlyRepairClient => ({
	all: async (sql, params) => sqlite.prepare(sql).all(...params),
	run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
});

interface AddressRow {
	flags: string;
	updated_at: number;
}

describe("addresses standing only on mail in Junk", () => {
	let sqlite: Database.Database;

	const mailbox = (mailboxId: string, specialUse: string | null): void => {
		sqlite
			.prepare(
				`INSERT INTO mailbox (
					mailbox_id, account_id, namespace_prefix, hierarchy_delimiter,
					full_path, uid_validity, uid_next, highest_modseq, message_count,
					unseen_count, deleted_count, total_size, last_sync_uid,
					high_water_mark_uid, last_message_sync_at, special_use,
					created_at, updated_at
				) VALUES (?, 'acc', '', '/', ?, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, ?, 0, 0)`,
			)
			.run(mailboxId, mailboxId, specialUse);
	};

	const specialUseEntry = (mailboxId: string, specialUse: string): void => {
		sqlite
			.prepare(
				`INSERT INTO mailbox_special_use_entry (
					mailbox_special_use_id, mailbox_id, special_use
				) VALUES (?, ?, ?)`,
			)
			.run(`${mailboxId}-${specialUse}`, mailboxId, specialUse);
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

	const address = (
		addressId: string,
		counters: { outbound?: number; reply?: number } = {},
		flags = "{}",
	): void => {
		sqlite
			.prepare(
				`INSERT INTO address (
					address_id, account_config_id, display_name, local_part, domain,
					normalized_email, normalized_compound, flags, inbound_count,
					outbound_count, reply_count, last_inbound_at, last_outbound_at,
					last_reply_at, created_at, updated_at
				) VALUES (?, 'cfg-1', 'Name', ?, 'example.com', ?, ?, ?, 0, ?, ?, 0,
					NULL, 0, 0, 0)`,
			)
			.run(
				addressId,
				addressId,
				`${addressId}@example.com`,
				`name ${addressId}@example.com`,
				flags,
				counters.outbound ?? 0,
				counters.reply ?? 0,
			);
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

	const read = (addressId: string): AddressRow =>
		sqlite
			.prepare("SELECT flags, updated_at FROM address WHERE address_id = ?")
			.get(addressId) as AddressRow;

	const withheld = (addressId: string): boolean =>
		JSON.parse(read(addressId).flags).junkOnly?.value === true;

	const addressCount = (): number =>
		(
			sqlite.prepare("SELECT count(*) AS n FROM address").get() as {
				n: number;
			}
		).n;

	before(() => {
		sqlite = new Database(":memory:");
		for (const table of [
			"address",
			"envelope_address",
			"message",
			"mailbox",
			"mailbox_special_use_entry",
		]) {
			sqlite.exec(shippedTableDdl(DDL_TAG, table));
		}
		sqlite.exec(
			readFileSync(
				new URL(
					"../../../../npm-scripts/sqlite-address-sightings-index.sql",
					import.meta.url,
				),
				"utf8",
			),
		);
	});

	after(() => {
		sqlite.close();
	});

	beforeEach(() => {
		for (const table of [
			"address",
			"envelope_address",
			"message",
			"mailbox",
			"mailbox_special_use_entry",
		]) {
			sqlite.exec(`DELETE FROM ${table}`);
		}
		mailbox("junk", '["Junk"]');
		specialUseEntry("junk", "Junk");
		mailbox("inbox", null);
		mailbox("trash", '["Trash"]');
		specialUseEntry("trash", "Trash");
		message("spam-1", "junk");
		message("spam-2", "junk");
		message("mail-1", "inbox");
		message("bin-1", "trash");
	});

	test("withholds an address seen only on mail in Junk", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		sighting("spammer", "spam-2");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.withholdable, 1);
		assert.equal(report.withheld, 1);
		assert.equal(withheld("spammer"), true);
		// `int64` on the wire, so the timestamp must not land as a float.
		assert.match(read("spammer").flags, /"setAt":\d+,/);
	});

	test("keeps an address with one sighting outside Junk", async () => {
		address("colleague");
		sighting("colleague", "spam-1");
		sighting("colleague", "mail-1");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("colleague"), false);
	});

	test("withholds an address whose only message moved into Junk", async () => {
		address("newsletter");
		sighting("newsletter", "mail-1");
		sqlite
			.prepare("UPDATE message SET mailbox_id = 'junk' WHERE message_id = ?")
			.run("mail-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("newsletter"), true);
	});

	test("restores an address whose message moved out of Junk", async () => {
		address("misfiled");
		sighting("misfiled", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");
		assert.equal(withheld("misfiled"), true);

		sqlite
			.prepare("UPDATE message SET mailbox_id = 'inbox' WHERE message_id = ?")
			.run("spam-1");
		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.restorable, 1);
		assert.equal(report.restored, 1);
		assert.equal(withheld("misfiled"), false);
	});

	test("leaves a mark the sync's own sighting in Junk put there", async () => {
		address(
			"spammer",
			{},
			'{"junkOnly":{"value":true,"setAt":1,"setBy":"junk-sighting"}}',
		);
		sighting("spammer", "mail-1");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("restores a sighting's mark once the account writes to the sender", async () => {
		address(
			"reformed",
			{ outbound: 1 },
			'{"junkOnly":{"value":true,"setAt":1,"setBy":"junk-sighting"}}',
		);
		sighting("reformed", "mail-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("reformed"), false);
	});

	test("never withholds an address the account has written to", async () => {
		address("client", { outbound: 1 });
		sighting("client", "spam-1");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("client"), false);
	});

	test("never withholds an address the account has replied to", async () => {
		address("friend", { reply: 2 });
		sighting("friend", "spam-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("friend"), false);
	});

	test("never withholds a VIP", async () => {
		address("boss", {}, '{"vip":{"value":true,"setAt":1}}');
		sighting("boss", "spam-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("boss"), false);
	});

	test("restores a withheld address once the account writes to it", async () => {
		address("reformed", {}, '{"junkOnly":{"value":true,"setAt":1}}');
		sighting("reformed", "spam-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");
		assert.equal(withheld("reformed"), true);

		sqlite
			.prepare("UPDATE address SET outbound_count = 1 WHERE address_id = ?")
			.run("reformed");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("reformed"), false);
	});

	test("leaves mail in Trash feeding the address book", async () => {
		address("ex-colleague");
		sighting("ex-colleague", "bin-1");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("ex-colleague"), false);
	});

	test("one deleted message does not keep a spammer suggestible", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		sighting("spammer", "bin-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("spammer"), true);
	});

	test("Trash reads the same whichever move happened first", async () => {
		address("junk-then-bin");
		address("bin-then-junk");
		sighting("junk-then-bin", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");
		sighting("junk-then-bin", "bin-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		sighting("bin-then-junk", "bin-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");
		sighting("bin-then-junk", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("junk-then-bin"), true);
		assert.equal(withheld("bin-then-junk"), true);
	});

	test("a cold sweep agrees with the moves that built the state", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		sighting("spammer", "bin-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		sqlite
			.prepare("UPDATE address SET flags = '{}' WHERE address_id = ?")
			.run("spammer");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("spammer"), true);
	});

	test("deleting every spam message leaves the mark standing", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		sqlite
			.prepare("UPDATE message SET mailbox_id = 'trash' WHERE message_id = ?")
			.run("spam-1");
		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("deleting the spam does not put its sender back", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		sqlite
			.prepare("UPDATE message SET mailbox_id = 'trash' WHERE message_id = ?")
			.run("spam-1");
		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("purging the spam does not put its sender back", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		sqlite.prepare("DELETE FROM message WHERE message_id = ?").run("spam-1");
		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("withholds a sender the account blocked or muted", async () => {
		address("reported", {}, '{"blocked":{"value":true,"setAt":1}}');
		address("hushed", {}, '{"muted":{"value":true,"setAt":1}}');
		sighting("reported", "spam-1");
		sighting("hushed", "spam-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("reported"), true);
		assert.equal(withheld("hushed"), true);
	});

	test("blocking a withheld sender never lifts the mark", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		sqlite
			.prepare(
				`UPDATE address SET flags = json_set(flags, '$.blocked',
					json_object('value', json('true'), 'setAt', 1))
				 WHERE address_id = ?`,
			)
			.run("spammer");
		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("reads a Junk folder a server does not designate", async () => {
		mailbox("named-spam", null);
		message("spam-5", "named-spam");
		address("by-name");
		sighting("by-name", "spam-5");
		sqlite
			.prepare("UPDATE mailbox SET full_path = 'Spam' WHERE mailbox_id = ?")
			.run("named-spam");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("by-name"), true);
	});

	test("reads a Junk folder nested under any prefix", async () => {
		mailbox("nested-spam", null);
		message("spam-6", "nested-spam");
		address("nested");
		sighting("nested", "spam-6");
		sqlite
			.prepare(
				"UPDATE mailbox SET full_path = 'INBOX/Spam' WHERE mailbox_id = ?",
			)
			.run("nested-spam");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("nested"), true);
	});

	test("reads a Junk folder under a delimiter that is not a slash", async () => {
		mailbox("dotted-spam", null);
		message("spam-7", "dotted-spam");
		address("dotted");
		sighting("dotted", "spam-7");
		sqlite
			.prepare(
				`UPDATE mailbox SET full_path = 'Mail.Junk E-mail',
					hierarchy_delimiter = '.' WHERE mailbox_id = ?`,
			)
			.run("dotted-spam");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("dotted"), true);
	});

	test("never reads a prefix as the folder it names", async () => {
		mailbox("spam-parent", null);
		message("mail-2", "spam-parent");
		address("under-spam");
		sighting("under-spam", "mail-2");
		sqlite
			.prepare(
				"UPDATE mailbox SET full_path = 'Spam/Receipts' WHERE mailbox_id = ?",
			)
			.run("spam-parent");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("under-spam"), false);
	});

	test("reads the designation from either place it is stored", async () => {
		mailbox("column-only", '["Junk"]');
		mailbox("entry-only", null);
		specialUseEntry("entry-only", "Junk");
		message("spam-3", "column-only");
		message("spam-4", "entry-only");
		address("by-column");
		address("by-entry");
		sighting("by-column", "spam-3");
		sighting("by-entry", "spam-4");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("by-column"), true);
		assert.equal(withheld("by-entry"), true);
	});

	test("leaves an address no message has ever carried alone", async () => {
		address("orphan");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("orphan"), false);
	});

	test("removes no row", async () => {
		address("spammer");
		address("colleague");
		address("client", { outbound: 3 });
		sighting("spammer", "spam-1");
		sighting("colleague", "mail-1");
		sighting("client", "spam-2");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(addressCount(), 3);
	});

	test("keeps the rest of an address's flags", async () => {
		address("noisy", {}, '{"muted":{"value":true,"setAt":7}}');
		sighting("noisy", "spam-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.deepEqual(JSON.parse(read("noisy").flags).muted, {
			value: true,
			setAt: 7,
		});
	});

	test("a second run writes nothing", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");
		const first = read("spammer");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.withholdable, 0);
		assert.equal(report.restorable, 0);
		assert.equal(report.withheld, 0);
		assert.equal(report.restored, 0);
		assert.deepEqual(read("spammer"), first);
	});

	test("check mode reports what it would do and writes nothing", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		address("misfiled", {}, '{"junkOnly":{"value":true,"setAt":1}}');
		sighting("misfiled", "mail-1");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "check");

		assert.equal(report.withholdable, 1);
		assert.equal(report.restorable, 1);
		assert.equal(report.withheld, 0);
		assert.equal(report.restored, 0);
		assert.equal(withheld("spammer"), false);
		assert.equal(withheld("misfiled"), true);
	});

	test("survives a row whose flags were never populated", async () => {
		address("legacy", {}, "");
		sighting("legacy", "spam-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("legacy"), true);
	});
});
