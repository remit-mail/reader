import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { BodyPartUpsertInput } from "@remit/data-ports";
import type { ImapBodyStructure } from "@remit/mailbox-service/types";
import Database from "better-sqlite3";
import { sweepForwardedMessageParts } from "../../drizzle-service/src/repair/forwarded-message-parts.js";
import { syncMessages } from "./handlers/sync-messages.js";
import { capturingLogger, openStore } from "./test-helpers/test-world.js";

const FIXTURE = readFileSync(
	resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../e2e/fixtures/mime-adversarial/04-forwarded-rfc822-with-attachments.eml",
	),
);

/** Fixture 04 as imapflow hands it over: the forwarded root reuses part "2". */
const FORWARDED: ImapBodyStructure = {
	type: "multipart/mixed",
	childNodes: [
		{ part: "1", type: "text/plain", encoding: "7bit", size: 115 },
		{
			part: "2",
			type: "message/rfc822",
			encoding: "7bit",
			size: 638,
			disposition: "attachment",
			dispositionParameters: { filename: "forwarded.eml" },
			childNodes: [
				{
					part: "2",
					type: "multipart/mixed",
					childNodes: [
						{ part: "2.1", type: "text/plain", encoding: "7bit", size: 40 },
						{
							part: "2.2",
							type: "application/pdf",
							encoding: "base64",
							size: 44,
							disposition: "attachment",
							dispositionParameters: { filename: "original.pdf" },
						},
					],
				},
			],
		},
	],
};

const part = (
	partPath: string,
	parentPartPath: string | null,
	mediaType: BodyPartUpsertInput["mediaType"],
	mediaSubtype: string,
): BodyPartUpsertInput => ({
	partPath,
	parentPartPath,
	mediaType,
	mediaSubtype,
	transferEncoding: "7BIT",
	sizeOctets: 40,
	isMultipart: mediaType === "MULTIPART",
	parameters: [],
});

/** What the old walker stored for fixture 04: the root overwrote the rfc822 row. */
const OVERWRITTEN: BodyPartUpsertInput[] = [
	part("0", null, "MULTIPART", "mixed"),
	part("1", "0", "TEXT", "plain"),
	part("2", "2", "MULTIPART", "mixed"),
	part("2.1", "2", "TEXT", "plain"),
	part("2.2", "2", "APPLICATION", "pdf"),
];

let store: Awaited<ReturnType<typeof openStore>>;

before(async () => {
	store = await openStore();
});

after(() => store.close());

describe("a forwarded message repaired on an instance already running", () => {
	it("gets its parts back from the server without moving the folder's cursor", async () => {
		const w = await store.world();
		const inbox = await w.folder("INBOX");
		const uid = w.imap.deliver("INBOX", FIXTURE, { bodyStructure: FORWARDED });
		const sync = () =>
			syncMessages(
				{
					type: "SYNC_MESSAGES",
					eventId: randomUUID(),
					timestamp: Date.now(),
					accountId: w.account.accountId,
					mailboxId: inbox.mailboxId,
				},
				capturingLogger([]),
				() => w.connectionFactory(),
			);
		await sync();
		await sync();
		const [seeded] = await w.client.message.listAllByMailbox(inbox.mailboxId);
		assert.ok(seeded);

		const sqlite = new Database(String(process.env.SQLITE_DB_PATH));
		sqlite
			.prepare("DELETE FROM body_part WHERE message_id = ?")
			.run(seeded.messageId);
		await w.client.envelope.upsertBodyParts(seeded.messageId, OVERWRITTEN);
		const before = await w.client.mailbox.get(
			w.account.accountId,
			inbox.mailboxId,
		);

		const report = await sweepForwardedMessageParts(
			{
				all: async (sql, params) => sqlite.prepare(sql).all(...params),
				run: async (sql, params) => sqlite.prepare(sql).run(...params).changes,
			},
			"repair",
		);
		sqlite.close();
		assert.equal(report.messages, 1);
		w.imap.store("INBOX", [uid], ["\\Flagged"]);

		await sync();

		const parts = await w.client.envelope.listBodyParts(seeded.messageId);
		const byPath = new Map(parts.map((p) => [p.partPath, p]));
		assert.deepEqual([...byPath.keys()].sort(), [
			"0",
			"1",
			"2",
			"2.0",
			"2.1",
			"2.2",
		]);
		assert.equal(byPath.get("2")?.mediaType, "MESSAGE");
		assert.equal(byPath.get("2")?.dispositionFilename, "forwarded.eml");

		const [listed] = await w.client.threadMessage.findAllByMessageId(
			w.account.accountConfigId,
			seeded.messageId,
		);
		assert.equal(listed?.hasStars, true);

		const after = await w.client.mailbox.get(
			w.account.accountId,
			inbox.mailboxId,
		);
		assert.equal(after.lastSyncUid, before.lastSyncUid);
		assert.equal(after.highWaterMarkUid, before.highWaterMarkUid);
		assert.notEqual(after.highestModseq, "");
	});
});
