import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type Database from "better-sqlite3";
import { createTestDb, type TestDb } from "../test-db.js";
import { AddressRepo } from "./i4-address.js";
import { MailboxSpecialUseRepo } from "./i4-mailbox-special-use.js";

const CONFIG = "cfg-1";

describe("reconciling one message's addresses at the moment it moves", () => {
	let db: TestDb;
	let sqlite: Database.Database;
	let close: () => Promise<void>;
	let repo: AddressRepo;
	let specialUse: MailboxSpecialUseRepo;

	const account = (accountId: string): void => {
		sqlite
			.prepare(
				`INSERT OR IGNORE INTO account (
					account_id, account_config_id, username, email, imap_host,
					imap_port, imap_tls, imap_start_tls, smtp_port, is_active,
					connection_state, created_at, updated_at
				) VALUES (?, ?, 'user', 'user@example.com', 'imap.example.com',
					993, 1, 0, 465, 1, 'disconnected', 0, 0)`,
			)
			.run(accountId, CONFIG);
	};

	/**
	 * A folder the server designated, written the way mailbox sync writes one:
	 * the denormalized column AND the entry row. The paths are deliberately not
	 * English — the role has to be read off the designation, not guessed from
	 * the name.
	 */
	const mailbox = (
		mailboxId: string,
		designation: string | null,
		folder: { accountId?: string; fullPath?: string } = {},
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
				) VALUES (?, ?, '', '/', ?, 1, 1, '0', 0, 0, 0, 0, 0, 0, 0, ?, 0, 0)`,
			)
			.run(
				mailboxId,
				accountId,
				folder.fullPath ?? mailboxId,
				designation ? JSON.stringify([designation]) : null,
			);
		if (!designation) return;
		sqlite
			.prepare(
				`INSERT INTO mailbox_special_use_entry (
					mailbox_special_use_id, mailbox_id, special_use
				) VALUES (?, ?, ?)`,
			)
			.run(`${mailboxId}-${designation}`, mailboxId, designation);
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
		specialUse = new MailboxSpecialUseRepo(db as never);
	});

	/**
	 * The roles the caller resolves once and hands down, covering every account
	 * under the config — which is the scope the predicate reads, because the
	 * address book is keyed by config.
	 */
	const reconcile = async (messageId: string): Promise<void> =>
		repo.reconcileJunkOnlyForMessage(
			messageId,
			await specialUse.resolveJunkRolesForConfig(CONFIG),
		);

	after(async () => {
		await close();
	});

	beforeEach(() => {
		for (const table of [
			"address",
			"envelope_address",
			"message",
			"mailbox",
			"mailbox_special_use_entry",
			"account",
		]) {
			sqlite.exec(`DELETE FROM ${table}`);
		}
		mailbox("inbox", null, { fullPath: "INBOX" });
		mailbox("junk", "Junk", { fullPath: "Ongewenst" });
		mailbox("trash", "Trash", { fullPath: "Prullenbak" });
	});

	test("a message moved into Junk stops the sender being suggested", async () => {
		message("msg", "inbox");
		await harvest("spammer");
		sighting("spammer", "msg");
		assert.deepEqual(await suggested("spammer"), ["spammer"]);

		moveTo("msg", "junk");
		await reconcile("msg");

		assert.equal(await withheld("spammer"), true);
		assert.deepEqual(await suggested("spammer"), []);
	});

	test("a sender the account has written to survives the move", async () => {
		message("msg", "inbox");
		await harvest("client");
		sighting("client", "msg");
		await repo.incrementOutboundCount(CONFIG, "client", Date.now());

		moveTo("msg", "junk");
		await reconcile("msg");

		assert.equal(await withheld("client"), false);
	});

	test("a sender still on live mail survives the move", async () => {
		message("spam", "inbox");
		message("real", "inbox");
		await harvest("colleague");
		sighting("colleague", "spam");
		sighting("colleague", "real");

		moveTo("spam", "junk");
		await reconcile("spam");

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
		await reconcile("msg");

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
		await reconcile("msg");

		assert.equal(await withheld("spammer"), true);
	});

	test("touches no address the message does not carry", async () => {
		message("msg", "inbox");
		message("other", "junk");
		await harvest("bystander");
		sighting("bystander", "other");

		moveTo("msg", "junk");
		await reconcile("msg");

		assert.equal(await withheld("bystander"), false);
	});

	test("a sender met only in Junk on two accounts of one config stays withheld", async () => {
		mailbox("junk-b", "Junk", {
			accountId: "acc-b",
			fullPath: "Indésirables",
		});
		message("ma", "junk");
		message("mb", "junk-b");
		await harvest("spammer");
		sighting("spammer", "ma");
		sighting("spammer", "mb");

		await reconcile("ma");
		assert.equal(await withheld("spammer"), true);

		await reconcile("mb");

		assert.equal(await withheld("spammer"), true);
	});

	/**
	 * The name hints are English only, so an account whose server flags nothing
	 * and whose Junk folder is called `Ongewenst` resolves no Junk at all. That
	 * silence must lift no mark: reading it as "every sighting is live mail"
	 * would hand the spammer back on the next move.
	 */
	test("a move never lifts a mark when no folder holds Junk", async () => {
		sqlite.exec("DELETE FROM mailbox_special_use_entry");
		sqlite.exec("UPDATE mailbox SET special_use = NULL");
		message("msg", "inbox");
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

		await reconcile("msg");

		assert.equal(await withheld("spammer"), true);
	});

	test("a second reconcile of the same move writes nothing new", async () => {
		message("msg", "inbox");
		await harvest("spammer");
		sighting("spammer", "msg");
		moveTo("msg", "junk");
		await reconcile("msg");
		const first = await repo.getAddress(CONFIG, "spammer");

		await reconcile("msg");

		assert.deepEqual(await repo.getAddress(CONFIG, "spammer"), first);
	});
});
