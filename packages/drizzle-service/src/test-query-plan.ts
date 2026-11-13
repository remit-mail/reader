import assert from "node:assert/strict";
import type { Logger } from "drizzle-orm/logger";
import type { SqliteConnection } from "./sqlite.js";

let captured: string[] | null = null;

/** The drizzle logger a test handle carries so `selectsIssuedDuring` sees its statements. */
export const statementLog: Logger = {
	logQuery: (query) => {
		captured?.push(query);
	},
};

export const selectsIssuedDuring = async (
	run: () => Promise<unknown>,
): Promise<string[]> => {
	const issued: string[] = [];
	captured = issued;
	try {
		await run();
	} finally {
		captured = null;
	}
	const selects = issued.filter((source) => /^\s*select/i.test(source));
	assert.ok(selects.length > 0, "the repo issued a select");
	return selects;
};

export const queryPlan = (
	sqlite: SqliteConnection,
	statements: string[],
): string[] =>
	statements.flatMap((source) => {
		const parameters = new Array((source.match(/\?/g) ?? []).length).fill(null);
		return (
			sqlite
				.prepare(`EXPLAIN QUERY PLAN ${source}`)
				.all(...parameters) as Array<{ detail: string }>
		).map((row) => row.detail);
	});

export const assertPlanSearches = (plan: string[], index: string): void => {
	const accesses = plan.filter((detail) => /^(SCAN|SEARCH) /.test(detail));
	assert.ok(
		accesses.length > 0,
		`no table access in plan: ${plan.join(" | ")}`,
	);
	for (const detail of accesses) {
		assert.match(
			detail,
			new RegExp(`^SEARCH \\S+ USING (COVERING )?INDEX ${index} `),
			`expected every table access to search ${index}: ${plan.join(" | ")}`,
		);
	}
};
