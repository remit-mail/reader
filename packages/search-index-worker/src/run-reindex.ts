import { createLogger } from "@remit/remit-logger-lambda";
import pg from "pg";
import { reindexAll } from "./reindex.js";
import { getServices } from "./services.js";

const log = createLogger();

const main = async (): Promise<void> => {
	const connectionString = process.env.PG_CONNECTION_URL;
	if (!connectionString) throw new Error("PG_CONNECTION_URL is required");

	const pool = new pg.Pool({ connectionString });
	const services = await getServices();

	const result = await reindexAll(pool, services, log);
	log.info("reindex complete", { ...result });

	await pool.end();
	process.exit(0);
};

await main();
