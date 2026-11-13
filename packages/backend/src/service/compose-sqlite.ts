import type { SpamDeployment } from "@remit/data-ports";
import type { ClassificationDeploymentDefault } from "@remit/data-ports/classification-presets";
import {
	createSqliteRepositories,
	NODE_SQLITE_LIMITS,
	openSqliteDatabases,
	sqliteDatabasePathsFromEnv,
} from "@remit/drizzle-service";
import {
	createRemitClient,
	type RemitClient,
	type RemitClientSharedDeps,
} from "./create-remit-client.js";
import {
	buildSharedDeps,
	sqsQueues,
	sqsQueueUrlsFromEnv,
} from "./shared-deps.js";

// The SQLite adapter composition (RFC 036). Every repo runs on the database
// that holds its tables: app, tenant mail or tenant search (#1420).
export const composeSqliteClient = async (
	shared: RemitClientSharedDeps,
): Promise<RemitClient> => {
	const databases = await openSqliteDatabases(sqliteDatabasePathsFromEnv());
	return createRemitClient({
		repositories: createSqliteRepositories(databases, NODE_SQLITE_LIMITS, {
			storage: shared.storage,
		}),
		...shared,
	});
};

export const buildSqliteClient = (
	classificationDefault: ClassificationDeploymentDefault,
	spamDeployment: SpamDeployment,
): Promise<RemitClient> =>
	composeSqliteClient(
		buildSharedDeps(
			sqsQueues(sqsQueueUrlsFromEnv()),
			classificationDefault,
			spamDeployment,
		),
	);
