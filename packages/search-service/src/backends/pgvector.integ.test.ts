/**
 * Exercises the pgvector store against a real local Postgres with the `vector`
 * extension (the pg-parity container). Proves upsert, cosine ranking,
 * multi-condition scoped filtering, content-hash lookup, and delete — the
 * multi-condition filter is the case that silently emptied results on S3
 * Vectors, so it is tested explicitly here.
 *
 * Gated behind RUN_INTEG_TESTS. Point PG_CONNECTION_URL at a database whose
 * `vector` extension is enabled (default: local remit_test).
 *
 *   npm run test:integ -w packages/search-service
 */
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import type { ChunkMetadata, VectorRecord } from "../types.js";
import type { VectorStoreService } from "./memory.js";
import { createPgVectorStore } from "./pgvector.js";

const RUN = process.env.RUN_INTEG_TESTS === "1";
const CONNECTION_STRING =
	process.env.PG_CONNECTION_URL ??
	"postgresql://remit:remit@localhost:5432/remit_test";

const DIMENSIONS = 4;

const meta = (
	over: Partial<ChunkMetadata> & { messageId: string },
): ChunkMetadata => ({
	threadId: "t-1",
	accountConfigId: "acc-1",
	mailboxIds: ["mb-1"],
	chunkType: "body",
	sentDate: 1000,
	isRead: false,
	hasAttachment: false,
	hasStars: false,
	...over,
});

const record = (
	chunkId: string,
	vector: number[],
	over: Partial<ChunkMetadata> & { messageId: string },
): VectorRecord => ({ chunkId, vector, metadata: meta(over) });

describe("pgvector store (integration)", { skip: !RUN }, () => {
	const table = `message_embedding_test_${randomUUID().replace(/-/g, "")}`;
	let store: VectorStoreService;
	let adminPool: pg.Pool;

	before(() => {
		adminPool = new pg.Pool({ connectionString: CONNECTION_STRING });
		store = createPgVectorStore({
			connectionString: CONNECTION_STRING,
			dimensions: DIMENSIONS,
			tableName: table,
		});
	});

	after(async () => {
		await adminPool.query(`DROP TABLE IF EXISTS ${table}`);
		await adminPool.end();
	});

	test("upsert then query ranks by cosine similarity", async () => {
		await store.upsert([
			record("c-x", [1, 0, 0, 0], { messageId: "m-x", contentHash: "hx" }),
			record("c-y", [0, 1, 0, 0], { messageId: "m-y", contentHash: "hy" }),
			record("c-z", [0.9, 0.1, 0, 0], { messageId: "m-z", contentHash: "hz" }),
		]);

		const matches = await store.query({ vector: [1, 0, 0, 0], topK: 3 });

		assert.equal(matches[0].chunkId, "c-x");
		assert.equal(matches[1].chunkId, "c-z");
		assert.equal(matches[2].chunkId, "c-y");
		assert.ok(matches[0].score > matches[1].score);
		assert.ok(matches[0].score > 0.99);
	});

	test("multi-condition scoped filter narrows to the matching partition", async () => {
		await store.upsert([
			record("s-a", [1, 0, 0, 0], {
				messageId: "m-a",
				accountConfigId: "acc-A",
				mailboxIds: ["inbox"],
				isRead: true,
			}),
			record("s-b", [1, 0, 0, 0], {
				messageId: "m-b",
				accountConfigId: "acc-A",
				mailboxIds: ["archive"],
				isRead: true,
			}),
			record("s-c", [1, 0, 0, 0], {
				messageId: "m-c",
				accountConfigId: "acc-B",
				mailboxIds: ["inbox"],
				isRead: true,
			}),
			record("s-d", [1, 0, 0, 0], {
				messageId: "m-d",
				accountConfigId: "acc-A",
				mailboxIds: ["inbox"],
				isRead: false,
			}),
		]);

		const matches = await store.query({
			vector: [1, 0, 0, 0],
			topK: 10,
			filter: { accountConfigId: "acc-A", mailboxId: "inbox", isRead: true },
		});

		const ids = matches.map((m) => m.chunkId);
		assert.deepEqual(ids, ["s-a"]);
	});

	test("existingContentHashes returns stored hashes only for known keys", async () => {
		const hashes = await store.existingContentHashes(["c-x", "c-y", "missing"]);
		assert.equal(hashes.get("c-x"), "hx");
		assert.equal(hashes.get("c-y"), "hy");
		assert.equal(hashes.has("missing"), false);
	});

	test("upsert overwrites an existing chunk in place", async () => {
		await store.upsert([
			record("c-x", [0, 0, 0, 1], { messageId: "m-x", contentHash: "hx2" }),
		]);
		const hashes = await store.existingContentHashes(["c-x"]);
		assert.equal(hashes.get("c-x"), "hx2");
	});

	test("delete removes every chunk of a message", async () => {
		await store.upsert([
			record("d-1", [1, 0, 0, 0], { messageId: "m-del" }),
			record("d-2", [0, 1, 0, 0], { messageId: "m-del" }),
		]);
		await store.delete({ messageId: "m-del" });
		const hashes = await store.existingContentHashes(["d-1", "d-2"]);
		assert.equal(hashes.size, 0);
	});
});
