import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SpamPipeline } from "@remit/data-ports";
import { deriveAddressId } from "@remit/data-ports/id";
import { simpleParser } from "mailparser";
import { extractPrimaryFromEmail } from "../classify-message.js";
import { FakeImapServer } from "../test-helpers/fake-imap.js";
import {
	arriveAt,
	openStore,
	recordingQueue,
	rescanServiceFor,
	type Store,
	seedAccount,
	seedMailbox,
	spamConfigFor,
	storeBody,
} from "../test-helpers/test-store.js";

/**
 * Real Junk false positives and true positives (issue #1428), one `.eml` per
 * message under `fixtures/junk/leaves` or `fixtures/junk/stays`. The
 * `X-Remit-Fixture-Sender-Messages` header stands in for the sender history
 * the account had when the message arrived.
 */
const CORPUS = new URL("./fixtures/junk/", import.meta.url);

const CALIBRATED: SpamPipeline = [
	{
		name: "Inline",
		thresholds: { state: "Set", cleanBelow: 0.2, spamAt: 0.9 },
	},
];

const fixturesIn = (outcome: "leaves" | "stays") =>
	readdirSync(new URL(`${outcome}/`, CORPUS))
		.filter((name) => name.endsWith(".eml"))
		.map((name) => ({
			name,
			outcome,
			raw: readFileSync(new URL(`${outcome}/${name}`, CORPUS)),
		}));

let store: Store;

beforeEach(async () => {
	store = await openStore();
});

afterEach(async () => {
	await store.close();
});

const seedSenderHistory = async (
	accountConfigId: string,
	raw: Buffer,
): Promise<void> => {
	const parsed = await simpleParser(raw);
	const seen = Number(
		parsed.headers.get("x-remit-fixture-sender-messages") ?? 0,
	);
	const email = extractPrimaryFromEmail(parsed);
	if (!email || seen === 0) return;
	const addressId = deriveAddressId(accountConfigId, email);
	const [localPart, domain] = email.split("@");
	await store.address.upsertAddress({
		addressId,
		accountConfigId,
		localPart,
		domain,
		normalizedEmail: email,
		normalizedCompound: email,
	});
	for (let count = 0; count < seen; count++) {
		await store.address.incrementInboundCount(accountConfigId, addressId, 1);
	}
};

describe("a rescan of Junk", () => {
	for (const fixture of [...fixturesIn("leaves"), ...fixturesIn("stays")]) {
		it(`${fixture.outcome === "leaves" ? "takes" : "keeps"} ${fixture.name} ${fixture.outcome === "leaves" ? "out of" : "in"} Junk`, async () => {
			const account = await seedAccount(store);
			const imap = new FakeImapServer();
			imap.addFolder("INBOX");
			await seedMailbox(store, account, "INBOX");
			const junk = await seedMailbox(store, account, "Junk", {
				specialUse: "Junk",
			});
			imap.addFolder(junk.fullPath);
			await seedSenderHistory(account.accountConfigId, fixture.raw);
			const storage = store.storage();
			const messageId = await arriveAt(store, imap, account, junk, fixture.raw);
			await storeBody(store, storage, account, messageId, fixture.raw);

			const result = await rescanServiceFor(store, storage, recordingQueue(), {
				...spamConfigFor(store),
				spamPipeline: CALIBRATED,
			}).rescan(account, { messageIds: [messageId], move: true });

			assert.deepEqual(result.failed, []);
			const leaves = fixture.outcome === "leaves";
			assert.equal(result.successful[0]?.moved, leaves);
			assert.equal(
				(await store.message.get(messageId)).mailboxId !== junk.mailboxId,
				leaves,
			);
		});
	}
});
