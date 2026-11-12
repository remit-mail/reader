import assert from "node:assert/strict";
import type { SqliteConnection } from "./sqlite.js";

export const selectsIssuedDuring = async (
	sqlite: SqliteConnection,
	run: () => Promise<unknown>,
): Promise<string[]> => {
	const captured: string[] = [];
	const original = sqlite.prepare.bind(sqlite);
	sqlite.prepare = ((source: string) => {
		captured.push(source);
		return original(source);
	}) as typeof sqlite.prepare;
	try {
		await run();
	} finally {
		sqlite.prepare = original as typeof sqlite.prepare;
	}
	const selects = captured.filter((source) => /^\s*select/i.test(source));
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
