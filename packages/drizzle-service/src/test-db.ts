import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let _instance: EmbeddedPostgres | null = null;
let _port = 0;

async function ensureStarted(): Promise<{ port: number }> {
	if (_instance) return { port: _port };

	for (let attempt = 0; attempt < 10; attempt++) {
		const port = 15000 + Math.floor(Math.random() * 5000);
		const instance = new EmbeddedPostgres({
			databaseDir: `/tmp/remit-test-pg-${process.pid}-${port}-${attempt}`,
			port,
			persistent: false,
		});
		try {
			await instance.initialise();
			await instance.start();
		} catch (err) {
			await instance.stop().catch(() => undefined);
			if (attempt === 9) throw err;
			continue;
		}
		_instance = instance;
		_port = port;
		process.on("exit", () => {
			instance.stop().catch(() => undefined);
		});
		return { port };
	}
	throw new Error("Failed to start embedded postgres");
}

export async function createTestDb(): Promise<{
	db: TestDb;
	pool: pg.Pool;
	close: () => Promise<void>;
}> {
	const { port } = await ensureStarted();

	const pool = new Pool({
		host: "localhost",
		port,
		user: "postgres",
		password: "password",
		database: "postgres",
	});

	const db = drizzle(pool, { schema }) as TestDb;

	const { apply } = await pushSchema(schema, drizzle(pool));
	await apply();

	return {
		db,
		pool,
		close: async () => {
			await pool.end();
			if (_instance) {
				const inst = _instance;
				_instance = null;
				await inst.stop();
			}
		},
	};
}

export { randomId } from "./id.js";
