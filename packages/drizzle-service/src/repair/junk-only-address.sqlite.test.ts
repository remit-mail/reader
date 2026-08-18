/**
 * The repair against the shape a deployment actually runs: the committed
 * `CREATE TABLE` blocks, not a schema pushed from the drizzle table objects.
 *
 * What this has to hold on a live database with no second copy of the data:
 * an address the account has written to or replied to keeps its place however
 * its mail was filed, one sighting outside Junk is enough to keep a row, a
 * mark is lifted again the moment the evidence turns, no row is removed, a
 * second run writes nothing, and `--check` writes nothing at all.
 */

import assert from "node:assert/strict";
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
	});

	test("keeps an address with one sighting outside Junk", async () => {
		address("colleague");
		sighting("colleague", "spam-1");
		sighting("colleague", "mail-1");

		const report = await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("colleague"), false);
	});

	/**
	 * The whole message moved into Junk after it was harvested — the case the
	 * write-time guard cannot reach, because the harvest already happened.
	 */
	test("withholds an address whose only message moved into Junk", async () => {
		address("newsletter");
		sighting("newsletter", "mail-1");
		sqlite
			.prepare("UPDATE message SET mailbox_id = 'junk' WHERE message_id = ?")
			.run("mail-1");

		await sweepJunkOnlyAddresses(clientOver(sqlite), "repair");

		assert.equal(withheld("newsletter"), true);
	});

	/**
	 * And back out again. The mark is lifted by the same pass that would have
	 * set it, so a rescue out of the spam folder never needs a second mechanism.
	 */
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

	/**
	 * A server that advertises the designation without the normalized entry rows,
	 * and one that has the rows without the column: either alone is the account's
	 * Junk folder.
	 */
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
