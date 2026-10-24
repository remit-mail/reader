import {
	createSqliteRepositories,
	openSqliteDatabases,
	sqliteDatabasePathsFromEnv,
} from "@remit/drizzle-service";
import {
	buildSharedDeps,
	createRemitClient,
	type RemitClient,
} from "./create-remit-client.js";

// The SQLite adapter composition (RFC 036). Every repo runs on the database
// that holds its tables: app, tenant mail or tenant search (#1420).
export const buildSqliteClient = async (): Promise<RemitClient> => {
	const databases = await openSqliteDatabases(sqliteDatabasePathsFromEnv());
	return createRemitClient({
		repositories: createSqliteRepositories(databases),
		...buildSharedDeps(),
	});
};
