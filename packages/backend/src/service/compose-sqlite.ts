import {
	createSqliteDatabase,
	createSqliteRepositories,
	messageDataSchema,
} from "@remit/drizzle-service";
import { env } from "expect-env";
import {
	buildSharedDeps,
	createRemitClient,
	type RemitClient,
} from "./create-remit-client.js";

// The SQLite adapter composition (RFC 036). Every repo runs on the single
// serialized connection `createSqliteDatabase` opens (D3), so a plain repo
// write cannot bypass serialization and join an open transaction's savepoint.
export const buildSqliteClient = async (): Promise<RemitClient> => {
	const sqliteDbPath = env.SQLITE_DB_PATH;

	const { db } = await createSqliteDatabase(messageDataSchema, {
		filename: sqliteDbPath,
	});
	return createRemitClient({
		repositories: createSqliteRepositories(db),
		...buildSharedDeps(),
	});
};
