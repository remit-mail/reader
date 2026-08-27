import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, test } from "node:test";
import { composeFolderRoleAppointmentName } from "@remit/data-ports/folder-role";
import { CanonicalMailboxRole } from "@remit/domain-enums";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { AccountSettingRepo } from "../repos/i4-account-setting.js";
import { MailboxSpecialUseRepo } from "../repos/i4-mailbox-special-use.js";
import { shippedTableDdl } from "../test-shipped-sqlite-schema.js";
import {
	type JunkOnlyRepairClient,
	type JunkOnlyRepairMode,
	type JunkOnlyReport,
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
	let specialUse: MailboxSpecialUseRepo;
	let accountSetting: AccountSettingRepo;

	/**
	 * Which folder holds Junk is resolved through the repository seam every
	 * other special-folder lookup reads, so the sweep honours an appointment and
	 * cannot disagree with the sync that harvested the address.
	 */
	const sweep = async (
		mode: JunkOnlyRepairMode = "repair",
	): Promise<JunkOnlyReport> =>
		sweepJunkOnlyAddresses(
			clientOver(sqlite),
			mode,
			await specialUse.resolveJunkRolesForInstance(),
		);

	const account = (accountId: string): void => {
		sqlite
			.prepare(
				`INSERT OR IGNORE INTO account (
					account_id, account_config_id, username, email, imap_host,
					imap_port, imap_tls, imap_start_tls, smtp_port, is_active,
					connection_state, created_at, updated_at
				) VALUES (?, 'cfg-1', 'user', 'user@example.com', 'imap.example.com',
					993, 1, 0, 465, 1, 'disconnected', 0, 0)`,
			)
			.run(accountId);
	};

	const mailbox = (
		mailboxId: string,
		designation: string | null,
		folder: {
			accountId?: string;
			fullPath?: string;
			hierarchyDelimiter?: string;
		} = {},
	): void => {
		const accountId = folder.accountId ?? "acc";
		account(accountId);
		sqlite
			.prepare(
				`INSERT INTO mailbox (
					mailbox_id, account_id, namespace_prefix, hierarchy_delimiter,
					full_path, uid_validity, uid_next, highest_modseq, message_count,
					unseen_count, deleted_count, total_size, last_sync_uid,
					high_water_mark_uid, last_message_sync_at, special_use,
					created_at, updated_at
				) VALUES (?, ?, '', ?, ?, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, ?, 0, 0)`,
			)
			.run(
				mailboxId,
				accountId,
				folder.hierarchyDelimiter ?? "/",
				folder.fullPath ?? mailboxId,
				designation,
			);
	};

	const appointJunk = async (
		accountId: string,
		mailboxId: string,
	): Promise<void> => {
		await accountSetting.upsert({
			accountConfigId: "cfg-1",
			name: composeFolderRoleAppointmentName(
				accountId,
				CanonicalMailboxRole.Junk,
			),
			value: { kind: "String", value: mailboxId },
		});
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
		const db = drizzle(sqlite);
		specialUse = new MailboxSpecialUseRepo(db as never);
		accountSetting = new AccountSettingRepo(db as never);
		for (const table of [
			"address",
			"envelope_address",
			"message",
			"mailbox",
			"mailbox_special_use_entry",
			"account_setting",
			"account",
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
			"account_setting",
			"account",
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

		const report = await sweep();

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

		const report = await sweep();

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("colleague"), false);
	});

	test("withholds an address whose only message moved into Junk", async () => {
		address("newsletter");
		sighting("newsletter", "mail-1");
		sqlite
			.prepare("UPDATE message SET mailbox_id = 'junk' WHERE message_id = ?")
			.run("mail-1");

		await sweep();

		assert.equal(withheld("newsletter"), true);
	});

	test("restores an address whose message moved out of Junk", async () => {
		address("misfiled");
		sighting("misfiled", "spam-1");
		await sweep();
		assert.equal(withheld("misfiled"), true);

		sqlite
			.prepare("UPDATE message SET mailbox_id = 'inbox' WHERE message_id = ?")
			.run("spam-1");
		const report = await sweep();

		assert.equal(report.restorable, 1);
		assert.equal(report.restored, 1);
		assert.equal(withheld("misfiled"), false);
	});

	test("never withholds an address the account has written to", async () => {
		address("client", { outbound: 1 });
		sighting("client", "spam-1");

		const report = await sweep();

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("client"), false);
	});

	test("never withholds an address the account has replied to", async () => {
		address("friend", { reply: 2 });
		sighting("friend", "spam-1");

		await sweep();

		assert.equal(withheld("friend"), false);
	});

	test("never withholds a VIP", async () => {
		address("boss", {}, '{"vip":{"value":true,"setAt":1}}');
		sighting("boss", "spam-1");

		await sweep();

		assert.equal(withheld("boss"), false);
	});

	test("restores a withheld address once the account writes to it", async () => {
		address("reformed", {}, '{"junkOnly":{"value":true,"setAt":1}}');
		sighting("reformed", "spam-1");

		await sweep();
		assert.equal(withheld("reformed"), true);

		sqlite
			.prepare("UPDATE address SET outbound_count = 1 WHERE address_id = ?")
			.run("reformed");
		await sweep();

		assert.equal(withheld("reformed"), false);
	});

	test("leaves mail in Trash feeding the address book", async () => {
		address("ex-colleague");
		sighting("ex-colleague", "bin-1");

		const report = await sweep();

		assert.equal(report.withholdable, 0);
		assert.equal(withheld("ex-colleague"), false);
	});

	test("one deleted message does not keep a spammer suggestible", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		sighting("spammer", "bin-1");

		await sweep();

		assert.equal(withheld("spammer"), true);
	});

	test("Trash reads the same whichever move happened first", async () => {
		address("junk-then-bin");
		address("bin-then-junk");
		sighting("junk-then-bin", "spam-1");
		await sweep();
		sighting("junk-then-bin", "bin-1");
		await sweep();

		sighting("bin-then-junk", "bin-1");
		await sweep();
		sighting("bin-then-junk", "spam-1");
		await sweep();

		assert.equal(withheld("junk-then-bin"), true);
		assert.equal(withheld("bin-then-junk"), true);
	});

	test("a cold sweep agrees with the moves that built the state", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		sighting("spammer", "bin-1");
		await sweep();

		sqlite
			.prepare("UPDATE address SET flags = '{}' WHERE address_id = ?")
			.run("spammer");
		await sweep();

		assert.equal(withheld("spammer"), true);
	});

	test("deleting every spam message leaves the mark standing", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweep();

		sqlite
			.prepare("UPDATE message SET mailbox_id = 'trash' WHERE message_id = ?")
			.run("spam-1");
		const report = await sweep();

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("deleting the spam does not put its sender back", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweep();

		sqlite
			.prepare("UPDATE message SET mailbox_id = 'trash' WHERE message_id = ?")
			.run("spam-1");
		const report = await sweep();

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("purging the spam does not put its sender back", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweep();

		sqlite.prepare("DELETE FROM message WHERE message_id = ?").run("spam-1");
		const report = await sweep();

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("withholds a sender the account blocked or muted", async () => {
		address("reported", {}, '{"blocked":{"value":true,"setAt":1}}');
		address("hushed", {}, '{"muted":{"value":true,"setAt":1}}');
		sighting("reported", "spam-1");
		sighting("hushed", "spam-1");

		await sweep();

		assert.equal(withheld("reported"), true);
		assert.equal(withheld("hushed"), true);
	});

	test("blocking a withheld sender never lifts the mark", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweep();

		sqlite
			.prepare(
				`UPDATE address SET flags = json_set(flags, '$.blocked',
					json_object('value', json('true'), 'setAt', 1))
				 WHERE address_id = ?`,
			)
			.run("spammer");
		const report = await sweep();

		assert.equal(report.restorable, 0);
		assert.equal(withheld("spammer"), true);
	});

	test("reads a Junk folder a server does not designate", async () => {
		mailbox("named-spam", null, { accountId: "acc-named", fullPath: "Spam" });
		message("spam-5", "named-spam");
		address("by-name");
		sighting("by-name", "spam-5");

		await sweep();

		assert.equal(withheld("by-name"), true);
	});

	test("reads a Junk folder nested under any prefix", async () => {
		mailbox("nested-spam", null, {
			accountId: "acc-nested",
			fullPath: "INBOX/Spam",
		});
		message("spam-6", "nested-spam");
		address("nested");
		sighting("nested", "spam-6");

		await sweep();

		assert.equal(withheld("nested"), true);
	});

	test("reads a Junk folder under a delimiter that is not a slash", async () => {
		mailbox("dotted-spam", null, {
			accountId: "acc-dotted",
			fullPath: "Mail.Junk E-mail",
			hierarchyDelimiter: ".",
		});
		message("spam-7", "dotted-spam");
		address("dotted");
		sighting("dotted", "spam-7");

		await sweep();

		assert.equal(withheld("dotted"), true);
	});

	test("never reads a prefix as the folder it names", async () => {
		mailbox("spam-parent", null, {
			accountId: "acc-parent",
			fullPath: "Spam/Receipts",
		});
		message("mail-2", "spam-parent");
		address("under-spam");
		sighting("under-spam", "mail-2");

		await sweep();

		assert.equal(withheld("under-spam"), false);
	});

	test("reads the designation the mailbox sync stored", async () => {
		mailbox("entry-only", null, {
			accountId: "acc-entry",
			fullPath: "Bulk",
		});
		specialUseEntry("entry-only", "Junk");
		message("spam-4", "entry-only");
		address("by-entry");
		sighting("by-entry", "spam-4");

		await sweep();

		assert.equal(withheld("by-entry"), true);
	});

	test("a second folder named Spam never claims the role", async () => {
		mailbox("second-spam", null, { fullPath: "Archive/Spam" });
		message("spam-3", "second-spam");
		address("filed-away");
		sighting("filed-away", "spam-3");

		await sweep();

		assert.equal(withheld("filed-away"), false);
	});

	test("withholds on the Junk folder the account appointed", async () => {
		mailbox("rubbish", null, {
			accountId: "acc-appointed",
			fullPath: "INBOX/Rubbish",
		});
		await appointJunk("acc-appointed", "rubbish");
		message("spam-8", "rubbish");
		address("appointed-spammer");
		sighting("appointed-spammer", "spam-8");

		await sweep();

		assert.equal(withheld("appointed-spammer"), true);
	});

	test("leaves the same folder alone when nobody appointed it", async () => {
		mailbox("unclaimed-rubbish", null, {
			accountId: "acc-unappointed",
			fullPath: "INBOX/Rubbish",
		});
		message("spam-9", "unclaimed-rubbish");
		address("stranger");
		sighting("stranger", "spam-9");

		await sweep();

		assert.equal(withheld("stranger"), false);
	});

	/**
	 * No folder holds Junk anywhere, so nothing is known about any sighting. The
	 * predicate must be silent in both directions: an empty id list read as "no
	 * message is in Junk" would make every sighting live mail and hand back
	 * every mark the instance had earned.
	 */
	test("an instance with no Junk folder neither withholds nor restores", async () => {
		for (const table of [
			"envelope_address",
			"message",
			"mailbox",
			"mailbox_special_use_entry",
		]) {
			sqlite.exec(`DELETE FROM ${table}`);
		}
		mailbox("plain-inbox", null, { fullPath: "INBOX" });
		message("mail-9", "plain-inbox");
		address("colleague");
		address("misfiled", {}, '{"junkOnly":{"value":true,"setAt":1}}');
		sighting("colleague", "mail-9");
		sighting("misfiled", "mail-9");

		const report = await sweep();

		assert.equal(report.withholdable, 0);
		assert.equal(report.restorable, 0);
		assert.equal(withheld("colleague"), false);
		assert.equal(withheld("misfiled"), true);
	});

	test("standing the account gave an address lifts its mark regardless", async () => {
		for (const table of ["mailbox", "mailbox_special_use_entry"]) {
			sqlite.exec(`DELETE FROM ${table}`);
		}
		mailbox("plain-inbox", null, { fullPath: "INBOX" });
		address(
			"reformed",
			{ outbound: 1 },
			'{"junkOnly":{"value":true,"setAt":1}}',
		);

		const report = await sweep();

		assert.equal(report.restorable, 1);
		assert.equal(withheld("reformed"), false);
	});

	test("leaves an address no message has ever carried alone", async () => {
		address("orphan");

		const report = await sweep();

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

		await sweep();

		assert.equal(addressCount(), 3);
	});

	test("keeps the rest of an address's flags", async () => {
		address("noisy", {}, '{"muted":{"value":true,"setAt":7}}');
		sighting("noisy", "spam-1");

		await sweep();

		assert.deepEqual(JSON.parse(read("noisy").flags).muted, {
			value: true,
			setAt: 7,
		});
	});

	test("a second run writes nothing", async () => {
		address("spammer");
		sighting("spammer", "spam-1");
		await sweep();
		const first = read("spammer");

		const report = await sweep();

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

		const report = await sweep("check");

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

		await sweep();

		assert.equal(withheld("legacy"), true);
	});
});
