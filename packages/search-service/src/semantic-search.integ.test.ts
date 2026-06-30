/**
 * Exercises the real local backends end to end: the persistent sqlite-vec
 * vector store and the Transformers.js (MiniLM) embedder. It proves the search
 * is semantic rather than keyword — the query shares no words with the target
 * message body, so the deterministic bag-of-words embedder would not rank it
 * first.
 *
 * Downloads the MiniLM model on first run, so it is gated behind RUN_INTEG_TESTS
 * and excluded from the default unit-test path.
 *
 *   npm run test:integ -w packages/remit-search-service
 */
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createSqliteVectorStore } from "./backends/sqlite-vec.js";
import { createLocalEmbeddingService } from "./embeddings.js";
import { createSearchService, type SearchService } from "./search.js";
import type { IndexEmailParams } from "./types.js";

const ACCOUNT_CONFIG_ID = "acc-1";

const message = (
	messageId: string,
	subject: string,
	body: string,
): IndexEmailParams => ({
	envelope: {
		from: { name: "Sender", email: "sender@example.com" },
		to: [{ name: "You", email: "you@example.com" }],
		cc: [],
		bcc: [],
		subject,
		attachments: [],
	},
	parsedBody: { text: body, html: null },
	metadata: {
		messageId,
		threadId: `thread-${messageId}`,
		accountConfigId: ACCOUNT_CONFIG_ID,
		mailboxIds: ["inbox"],
		sentDate: 1_700_000_000,
		isRead: false,
		hasAttachment: false,
		hasStars: false,
	},
});

const FLIGHT = message(
	"msg-flight",
	"Your itinerary",
	"Your flight is confirmed. You depart Amsterdam Schiphol bound for New York JFK on Tuesday morning; please arrive at the gate early.",
);
const FINANCE = message(
	"msg-finance",
	"Quarterly numbers",
	"The quarterly earnings report is attached. Revenue rose twelve percent and operating margin improved over the previous period.",
);
const DENTIST = message(
	"msg-dentist",
	"See you soon",
	"This is a reminder that your dental check-up is scheduled for next Monday at nine in the morning. Call us to reschedule.",
);

describe(
	"semantic search over real local backends",
	{ skip: !process.env.RUN_INTEG_TESTS },
	() => {
		let dir: string;
		let dbPath: string;
		let search: SearchService;

		before(async () => {
			dir = mkdtempSync(join(tmpdir(), "remit-vec-"));
			dbPath = join(dir, "vectors.sqlite");
			search = createSearchService({
				store: createSqliteVectorStore({ path: dbPath }),
				embedder: createLocalEmbeddingService(),
			});
			await search.index(FLIGHT);
			await search.index(FINANCE);
			await search.index(DENTIST);
		});

		after(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		test("a paraphrased query returns the semantically closest message", async () => {
			const results = await search.search({
				query: "air travel reservation booking",
				accountConfigId: ACCOUNT_CONFIG_ID,
				limit: 3,
			});

			assert.ok(results.length > 0, "expected at least one hit");
			assert.equal(
				results[0].messageId,
				"msg-flight",
				`expected the flight message to rank first, got ${results
					.map((r) => r.messageId)
					.join(", ")}`,
			);
		});

		test("vectors persist to disk across store instances", async () => {
			const reopened = createSearchService({
				store: createSqliteVectorStore({ path: dbPath }),
				embedder: createLocalEmbeddingService(),
			});
			const results = await reopened.search({
				query: "earnings and revenue report",
				accountConfigId: ACCOUNT_CONFIG_ID,
				limit: 3,
			});
			assert.equal(results[0].messageId, "msg-finance");
		});

		test("the metadata filter scopes results to the account", async () => {
			const results = await search.search({
				query: "air travel reservation booking",
				accountConfigId: "other-account",
				limit: 3,
			});
			assert.equal(results.length, 0);
		});
	},
);
