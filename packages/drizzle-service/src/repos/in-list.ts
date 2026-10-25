import { type Column, type SQL, sql } from "drizzle-orm";

export const inList = <T extends Column>(
	column: T,
	values: readonly T["_"]["data"][],
): SQL =>
	sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;

export const pairInList = <A extends Column, B extends Column>(
	first: A,
	second: B,
	pairs: readonly (readonly [A["_"]["data"], B["_"]["data"]])[],
): SQL =>
	sql`(${first}, ${second}) in (select value->>0, value->>1 from json_each(${JSON.stringify(pairs)}))`;
