import { type Column, type SQL, sql } from "drizzle-orm";

export const inList = (
	column: Column,
	values: readonly (string | number)[],
): SQL =>
	sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
