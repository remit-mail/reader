import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { recordingQueue } from "@remit/data-ports/recording-queue";
import {
	BETTER_SQLITE3_LIMITS,
	composeSqliteRepositories,
	openSqliteDatabases,
	syncStores,
} from "@remit/drizzle-service";
import { createShippedSqliteFiles } from "@remit/drizzle-service/test-sqlite";
import { noopLogger } from "@remit/logger";
import { cascadeServicesOf } from "../cascade.js";
import { buildRelationalDeletionCapabilities } from "../compose-relational.js";
import type { AccountDeleteFinalizeEvent } from "../events.js";
import {
	finalizeAccountDelete,
	processAccountDelete,
} from "./account-delete.js";

const exists = (path: string): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);

const writeUnder = async (base: string, key: string): Promise<string> => {
	const full = join(base, key);
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, "x");
	return full;
};

describe("account delete on a host that runs the finalize step from its own queue", () => {
	const previousStoragePath = process.env.STORAGE_LOCAL_PATH;
	let directory: string;
	let close: () => Promise<void>;
	let repositories: ReturnType<typeof composeSqliteRepositories>;

	before(async () => {
		directory = await mkdtemp(join(tmpdir(), "remit-account-delete-"));
		process.env.STORAGE_LOCAL_PATH = join(directory, "storage");
		const databases = await openSqliteDatabases(
			createShippedSqliteFiles(directory),
		);
		close = databases.close;
		repositories = composeSqliteRepositories(
			syncStores(databases, BETTER_SQLITE3_LIMITS),
		);
	});

	after(async () => {
		await close();
		if (previousStoragePath === undefined)
			delete process.env.STORAGE_LOCAL_PATH;
		else process.env.STORAGE_LOCAL_PATH = previousStoragePath;
	});

	it("signs out, queues the finalize step, and the finalize step erases the tenant", async () => {
		const accountConfig = await repositories.accountConfig.create({
			userId: "user000000000000000000001",
		});
		const { accountConfigId } = accountConfig;
		await repositories.accountExportRequest.create({
			accountConfigId,
			userId: accountConfig.userId,
			state: "Ready",
		});
		await repositories.label.create({ accountConfigId, name: "Receipts" });
		const storage = process.env.STORAGE_LOCAL_PATH ?? "";
		const stored = [
			await writeUnder(storage, `accounts/${accountConfigId}/a/body.eml`),
			await writeUnder(storage, `exports/${accountConfigId}/e/export.zip`),
		];

		const services = cascadeServicesOf(repositories);
		const capabilities = buildRelationalDeletionCapabilities();
		const queue = recordingQueue();
		const signedOut: string[] = [];

		await processAccountDelete(
			{ type: "AccountDelete", accountConfigId },
			noopLogger,
			{
				services,
				signOut: async (userId) => {
					signedOut.push(userId);
				},
				enqueueFinalize: (event) => queue.send({ body: event }),
			},
		);
		assert.deepEqual(signedOut, [accountConfig.userId]);
		const [queued] = queue.sent;
		assert.deepEqual(queued?.body, {
			type: "FinalizeAccountDelete",
			accountConfigId,
		});

		const finalize: AccountDeleteFinalizeEvent = {
			type: "FinalizeAccountDelete",
			accountConfigId,
		};
		await finalizeAccountDelete(finalize, noopLogger, {
			services,
			capabilities,
		});

		assert.deepEqual(
			await repositories.accountConfig.get([accountConfigId]),
			[],
		);
		assert.deepEqual(
			(
				await repositories.accountExportRequest.listByAccountConfig(
					accountConfigId,
				)
			).items,
			[],
		);
		assert.deepEqual(
			await repositories.label.listByAccountConfig(accountConfigId),
			[],
		);
		for (const path of stored) {
			assert.equal(await exists(path), false, `${path} must be deleted`);
		}

		await finalizeAccountDelete(finalize, noopLogger, {
			services,
			capabilities,
		});
	});
});
