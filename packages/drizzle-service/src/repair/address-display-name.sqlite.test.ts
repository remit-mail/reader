/**
 * The repair against the shape a deployment actually runs: the committed
 * `CREATE TABLE` blocks, not a schema pushed from the drizzle table objects.
 *
 * What this has to hold, on a live database with no second copy of the data:
 * every name the harvest guard would keep survives, a name that says something
 * besides the address keeps that something, no row is removed, and a second run
 * writes nothing.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { storedDisplayName } from "@remit/data-ports/display-name";
import Database from "better-sqlite3";
import { shippedTableDdl } from "../test-shipped-sqlite-schema.js";
import {
	type DisplayNameRepairClient,
	EMBEDDED_ADDRESS_LIKE,
	sweepDisplayNames,
} from "./address-display-name.js";

const SPOOF = "aramirez@secresaludguaviare.gov.co";

const clientOver = (sqlite: Database.Database): DisplayNameRepairClient => ({
	all: async (sql, params) => sqlite.prepare(sql).all(...params),
	run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
});

const seed = (sqlite: Database.Database): void => {
	sqlite.exec(shippedTableDdl("0000_happy_roland_deschain", "address"));
	sqlite.exec(
		shippedTableDdl("0000_happy_roland_deschain", "envelope_address"),
	);
	sqlite.exec(shippedTableDdl("0000_happy_roland_deschain", "thread_message"));

	const address = sqlite.prepare(
		`INSERT INTO address (
			address_id, account_config_id, display_name, local_part, domain,
			normalized_email, normalized_compound, flags, inbound_count,
			outbound_count, reply_count, last_inbound_at, last_outbound_at,
			last_reply_at, created_at, updated_at
		) VALUES (?, 'cfg-1', ?, 'x', 'y', ?, ?, '{}', 0, 0, 0, 0, NULL, 0, 0, 0)`,
	);
	const addressRow = (id: string, name: string | null, email: string): void => {
		address.run(
			id,
			name,
			email,
			`${(name ?? "").toLowerCase()} ${email}`.trim(),
		);
	};

	addressRow("spoof", "matthijs@ischen.nl", SPOOF);
	addressRow("embedded", "Matthijs <matthijs@ischen.nl>", SPOOF);
	addressRow("tabbed", "Support\tmatthijs@ischen.nl", SPOOF);
	addressRow("parenthesised", "Support (support@acme.com)", "noreply@acme.com");
	addressRow("comma", "matthijs@ischen.nl, team", SPOOF);
	addressRow("semicolon", "Team; matthijs@ischen.nl", SPOOF);
	addressRow("self", "ing@ing-nl-mailing.nl", "ing@ing-nl-mailing.nl");
	addressRow("self-cased", "Matthijs@Ischen.nl", "matthijs@ischen.nl");
	addressRow("self-diacritic", "Özcan@example.com", "özcan@example.com");
	addressRow("self-in-name", "Özcan <Özcan@example.com>", "özcan@example.com");
	addressRow("human", "Matthijs van Henten", "matthijs@ischen.nl");
	addressRow("absent", null, "quiet@example.com");
	addressRow("blank", "", "blank@example.com");

	const envelope = sqlite.prepare(
		`INSERT INTO envelope_address (
			envelope_address_id, message_id, address_id, display_name,
			normalized_email, address_role, address_order, created_at, updated_at
		) VALUES (?, 'msg-1', 'addr-1', ?, ?, 'From', 0, 0, 0)`,
	);
	envelope.run("env-spoof", "matthijs@ischen.nl", SPOOF);
	envelope.run("env-self", "Özcan@example.com", "özcan@example.com");
	envelope.run("env-human", "Matthijs van Henten", "matthijs@ischen.nl");

	const thread = sqlite.prepare(
		`INSERT INTO thread_message (
			thread_message_id, thread_id, message_id, account_config_id, mailbox_id,
			uid, reference_order, from_email, from_name, subject, internal_date,
			sent_date, is_read, has_attachment, has_stars, is_deleted,
			created_at, updated_at
		) VALUES (?, 'thr-1', 'msg-1', 'cfg-1', 'mbx-1', 1, 0, ?, ?, 's', 0, 0, 0, 0, 0, 0, 0, 0)`,
	);
	thread.run("thr-spoof", SPOOF, "matthijs@ischen.nl");
	thread.run("thr-named", SPOOF, "Support <matthijs@ischen.nl>");
	thread.run("thr-unparseable", null, "matthijs@ischen.nl");
	thread.run("thr-human", SPOOF, "Alejandro Ramirez");
};

describe("rewriting display names that claim another address", () => {
	let sqlite: Database.Database;
	let client: DisplayNameRepairClient;

	before(() => {
		sqlite = new Database(":memory:");
		seed(sqlite);
		client = clientOver(sqlite);
	});

	after(() => {
		sqlite.close();
	});

	const nameOf = (id: string): string | null =>
		(
			sqlite
				.prepare("SELECT display_name AS n FROM address WHERE address_id = ?")
				.get(id) as { n: string | null }
		).n;

	test("check writes nothing and counts what repair would rewrite", async () => {
		const report = await sweepDisplayNames(client, "check");

		assert.equal(report.claiming, 10);
		assert.deepEqual(
			report.sites.map((site) => [site.table, site.claiming, site.rewritten]),
			[
				["address", 6, 0],
				["envelope_address", 1, 0],
				["thread_message", 3, 0],
			],
		);
		assert.equal(nameOf("spoof"), "matthijs@ischen.nl");
	});

	test("repair rewrites exactly those rows", async () => {
		const report = await sweepDisplayNames(client, "repair");

		assert.deepEqual(
			report.sites.map((site) => [site.table, site.rewritten]),
			[
				["address", 6],
				["envelope_address", 1],
				["thread_message", 3],
			],
		);
	});

	test("empties a name that is nothing but another address", () => {
		assert.equal(nameOf("spoof"), "");
	});

	test("keeps the text a name carries besides the address", () => {
		const kept: ReadonlyArray<readonly [string, string]> = [
			["embedded", "Matthijs"],
			["tabbed", "Support"],
			["parenthesised", "Support"],
			["comma", "team"],
			["semicolon", "Team"],
		];
		for (const [id, remainder] of kept) {
			assert.equal(nameOf(id), remainder, id);
		}
	});

	test("rebuilds the search compound the way the app writes it", () => {
		const rows = sqlite
			.prepare(
				"SELECT address_id AS id, normalized_compound AS c FROM address WHERE address_id IN ('spoof', 'embedded') ORDER BY address_id",
			)
			.all() as Array<{ id: string; c: string }>;
		assert.deepEqual(
			rows.map((row) => [row.id, row.c]),
			[
				["embedded", `matthijs ${SPOOF}`],
				["spoof", SPOOF],
			],
		);
	});

	test("keeps every name the harvest guard keeps", () => {
		const kept: ReadonlyArray<readonly [string, string | null]> = [
			["self", "ing@ing-nl-mailing.nl"],
			["self-cased", "Matthijs@Ischen.nl"],
			["self-diacritic", "Özcan@example.com"],
			["self-in-name", "Özcan <Özcan@example.com>"],
			["human", "Matthijs van Henten"],
			["absent", null],
			["blank", ""],
		];
		for (const [id, name] of kept) {
			assert.equal(nameOf(id), name, id);
		}
	});

	test("clears the From line the message header renders", () => {
		const rows = sqlite
			.prepare(
				"SELECT envelope_address_id AS id, display_name AS n FROM envelope_address ORDER BY envelope_address_id",
			)
			.all() as Array<{ id: string; n: string | null }>;
		assert.deepEqual(rows, [
			{ id: "env-human", n: "Matthijs van Henten" },
			{ id: "env-self", n: "Özcan@example.com" },
			{ id: "env-spoof", n: "" },
		]);
	});

	test("clears the sender label in the message list", () => {
		const rows = sqlite
			.prepare(
				"SELECT thread_message_id AS id, from_name AS n FROM thread_message ORDER BY thread_message_id",
			)
			.all() as Array<{ id: string; n: string | null }>;
		assert.deepEqual(rows, [
			{ id: "thr-human", n: "Alejandro Ramirez" },
			{ id: "thr-named", n: "Support" },
			{ id: "thr-spoof", n: null },
			{ id: "thr-unparseable", n: null },
		]);
	});

	test("removes no row", () => {
		for (const [table, count] of [
			["address", 13],
			["envelope_address", 3],
			["thread_message", 4],
		] as const) {
			const row = sqlite
				.prepare(`SELECT count(*) AS n FROM ${table}`)
				.get() as {
				n: number;
			};
			assert.equal(row.n, count, table);
		}
	});

	test("a second run writes nothing", async () => {
		const report = await sweepDisplayNames(client, "repair");
		assert.equal(report.claiming, 0);
	});
});

/**
 * The SQL in this repair narrows; it never decides. That only holds if no name
 * the rule rewrites can slip past the narrowing — the case where a planted name
 * would survive the sweep unseen.
 */
describe("the SQL narrowing is a superset of the rule", () => {
	test("selects every name the rule rewrites", () => {
		const sqlite = new Database(":memory:");
		sqlite.exec("CREATE TABLE probe (name text)");
		const insert = sqlite.prepare("INSERT INTO probe VALUES (?)");
		const names = [
			"matthijs@ischen.nl",
			"Matthijs <matthijs@ischen.nl>",
			"Support (support@acme.com)",
			"Support\tmatthijs@ischen.nl",
			"Support matthijs@ischen.nl",
			"Support​matthijs@ischen.nl",
			"prvs=0068b51f37=matthijs@ischen.nl",
			'"matthijs@ischen.nl"',
			"matthijs@ischen.nl, team",
			"Team; matthijs@ischen.nl",
			"Özcan@example.com",
			"MATTHIJS@ISCHEN.NL",
			"matthijs@mail.ischen.nl",
			"Matthijs van Henten",
			"me @ home",
			"a@b.c",
			"",
		];
		for (const name of names) insert.run(name);

		const selected = new Set(
			(
				sqlite
					.prepare("SELECT name FROM probe WHERE name LIKE ?")
					.all(EMBEDDED_ADDRESS_LIKE) as Array<{ name: string }>
			).map((row) => row.name),
		);
		sqlite.close();

		for (const name of names) {
			if (storedDisplayName(name, "nobody@example.org") === name) continue;
			assert.equal(selected.has(name), true, name);
		}
	});
});
