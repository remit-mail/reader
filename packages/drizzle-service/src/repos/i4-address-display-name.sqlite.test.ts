/**
 * The write-path guard only covers what is harvested from now on. The rows a
 * spoofing sender already planted stay live until a migration clears them —
 * on the affected instance there were 150 email-shaped display names, 30 of
 * them naming an address other than their own (issue #826).
 *
 * The migration blanks the name and nothing else: no row is removed, and the
 * address stays reachable.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import Database from "better-sqlite3";
import {
	applyMigration,
	shippedTableDdl,
} from "../test-shipped-sqlite-schema.js";

const MIGRATION = "0015_clear_spoofed_address_display_name";

interface AddressRow {
	address_id: string;
	display_name: string | null;
	normalized_email: string;
	normalized_compound: string;
}

const insert = (
	sqlite: Database.Database,
	addressId: string,
	displayName: string | null,
	normalizedEmail: string,
): void => {
	const compound =
		`${(displayName ?? "").toLowerCase()} ${normalizedEmail}`.trim();
	sqlite
		.prepare(
			`INSERT INTO address (
				address_id, account_config_id, display_name, local_part, domain,
				normalized_email, normalized_compound, flags, inbound_count,
				outbound_count, reply_count, last_inbound_at, last_outbound_at,
				last_reply_at, created_at, updated_at
			) VALUES (?, 'cfg-1', ?, ?, ?, ?, ?, '{}', 0, 0, 0, 0, NULL, 0, 0, 0)`,
		)
		.run(
			addressId,
			displayName,
			normalizedEmail.split("@")[0],
			normalizedEmail.split("@")[1],
			normalizedEmail,
			compound,
		);
};

describe(`migration ${MIGRATION}`, () => {
	let sqlite: Database.Database;
	let rows: Map<string, AddressRow>;

	before(() => {
		sqlite = new Database(":memory:");
		sqlite.exec(shippedTableDdl("0000_happy_roland_deschain", "address"));

		insert(
			sqlite,
			"spoof",
			"matthijs@ischen.nl",
			"aramirez@secresaludguaviare.gov.co",
		);
		insert(
			sqlite,
			"spoof-cased",
			"ING@ing-nl-mailing.nl",
			"no-reply@thefreshcoffee.com",
		);
		insert(sqlite, "self", "ing@ing-nl-mailing.nl", "ing@ing-nl-mailing.nl");
		insert(sqlite, "self-cased", "Matthijs@Ischen.nl", "matthijs@ischen.nl");
		insert(sqlite, "human", "Matthijs van Henten", "matthijs@ischen.nl");
		insert(
			sqlite,
			"human-with-address",
			"Matthijs <matthijs@ischen.nl>",
			"spam@example.com",
		);
		insert(sqlite, "hostless", "matthijs@localhost", "spam@example.com");
		insert(sqlite, "absent", null, "quiet@example.com");
		insert(sqlite, "blank", "", "blank@example.com");

		applyMigration(sqlite, MIGRATION);

		rows = new Map(
			(sqlite.prepare("SELECT * FROM address").all() as AddressRow[]).map(
				(row) => [row.address_id, row],
			),
		);
	});

	after(() => {
		sqlite.close();
	});

	test("keeps every address row", () => {
		assert.equal(rows.size, 9);
	});

	test("blanks a display name naming an address the row does not own", () => {
		const row = rows.get("spoof");
		assert.ok(row);
		assert.equal(row.display_name, "");
		assert.equal(row.normalized_email, "aramirez@secresaludguaviare.gov.co");
		assert.equal(row.normalized_compound, "aramirez@secresaludguaviare.gov.co");
	});

	test("compares the name to the address case-insensitively", () => {
		const spoofed = rows.get("spoof-cased");
		assert.ok(spoofed);
		assert.equal(spoofed.display_name, "");

		const own = rows.get("self-cased");
		assert.ok(own);
		assert.equal(own.display_name, "Matthijs@Ischen.nl");
	});

	test("leaves a name that is the address it labels", () => {
		const row = rows.get("self");
		assert.ok(row);
		assert.equal(row.display_name, "ing@ing-nl-mailing.nl");
		assert.equal(
			row.normalized_compound,
			"ing@ing-nl-mailing.nl ing@ing-nl-mailing.nl",
		);
	});

	test("leaves a name that is not itself an address", () => {
		const untouched: Array<[string, string | null]> = [
			["human", "Matthijs van Henten"],
			["human-with-address", "Matthijs <matthijs@ischen.nl>"],
			["hostless", "matthijs@localhost"],
			["absent", null],
			["blank", ""],
		];

		for (const [addressId, displayName] of untouched) {
			const row = rows.get(addressId);
			assert.ok(row);
			assert.equal(row.display_name, displayName);
		}
	});
});
