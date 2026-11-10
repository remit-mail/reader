import assert from "node:assert/strict";
import type Database from "better-sqlite3";

export interface PlannableQuery {
	toSQL(): { sql: string; params: unknown[] };
}

export const queryPlan = (
	sqlite: Database.Database,
	query: PlannableQuery,
): string[] => {
	const { sql, params } = query.toSQL();
	return (
		sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
			detail: string;
		}[]
	).map((row) => row.detail);
};

export const assertPlanUsesIndex = (
	sqlite: Database.Database,
	query: PlannableQuery,
	index: string,
): void => {
	const plan = queryPlan(sqlite, query);
	const searches = plan.filter((line) => /^(SCAN|SEARCH) /.test(line));
	assert.ok(
		searches.length > 0,
		`no table access in plan:\n${plan.join("\n")}`,
	);
	for (const line of searches) {
		assert.match(
			line,
			new RegExp(`^SEARCH \\S+ USING (COVERING )?INDEX ${index} `),
			`expected every table access to search ${index}:\n${plan.join("\n")}`,
		);
	}
};
