import {
	createSqliteDatabase,
	DrizzleMessageRepository,
	messageDataSchema,
} from "@remit/drizzle-service";
import { buildEmbeddingServiceFromEnv } from "@remit/search-service/from-env";
import { readSqliteIndexedChunks } from "@remit/search-service/sqlite-vec";
import { formatReembed, parseReembedScope, reembedIndex } from "./reembed.js";

const vectorPath = process.env.LOCAL_VECTORDB_PATH;
if (!vectorPath) {
	process.stderr.write(
		"LOCAL_VECTORDB_PATH is unset, so this deployment keeps no vector index on disk and there is nothing to re-embed.\n",
	);
	process.exit(1);
}
const dbPath = process.env.SQLITE_DB_PATH;
if (!dbPath) {
	process.stderr.write(
		"SQLITE_DB_PATH is unset, so there is no outbox to queue the re-embed on.\n",
	);
	process.exit(1);
}

const scope = parseReembedScope(process.argv.slice(2));
const { db, close } = await createSqliteDatabase(messageDataSchema, {
	filename: dbPath,
});
const result = await reembedIndex({
	configuredEmbeddingId: buildEmbeddingServiceFromEnv().embeddingId,
	scope,
	readChunks: (consume) => readSqliteIndexedChunks(vectorPath, consume),
	queue: new DrizzleMessageRepository(db),
}).finally(close);
process.stdout.write(formatReembed(result));
