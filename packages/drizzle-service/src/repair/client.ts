import type { SqliteValue } from "../sqlite.js";

export interface SqliteRepairClient {
	all(sql: string, params: readonly SqliteValue[]): Promise<unknown[]>;
	run(sql: string, params: readonly SqliteValue[]): Promise<number>;
}
