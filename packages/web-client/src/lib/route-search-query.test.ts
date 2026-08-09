/**
 * `q` lives on the parent `/mail` route, but every list re-declares it: a
 * child's `validateSearch` is authoritative for its own URL, so a list that
 * omits `q` strips it. The top bar mounts a search field on all four lists, so
 * a stripped `q` means typing a query does nothing and the query is lost on the
 * next navigation.
 *
 * Two halves: the schemas carry `q`, and each route is wired to the schema
 * declared for its own path. The second half has to load route files, so it runs
 * out of process — see `test-support/list-search-binding.ts`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { mailIndexSearchSchema, mailListSearchSchemas } from "./mail-search.js";

const schemas = {
	...mailListSearchSchemas,
	"/mail/ (the redirect to the brief)": mailIndexSearchSchema,
};

describe("every /mail list carries `q` through its own validation", () => {
	for (const [name, schema] of Object.entries(schemas)) {
		it(`${name} preserves a query`, () => {
			const parsed = schema.parse({ q: "invoice" }) as { q?: string };
			assert.equal(
				parsed.q,
				"invoice",
				`${name} drops q, so the top bar's search field is inert there`,
			);
		});

		it(`${name} leaves q absent when there is none`, () => {
			const parsed = schema.parse({}) as { q?: string };
			assert.equal(parsed.q, undefined);
		});
	}
});

describe("every /mail list route uses the schema declared for its path", () => {
	it("holds for all four lists", () => {
		const support = fileURLToPath(
			new URL("../../test-support/", import.meta.url),
		);
		assert.doesNotThrow(() =>
			execFileSync(
				process.execPath,
				[
					"--import",
					"tsx",
					"--import",
					`${support}register.mjs`,
					`${support}list-search-binding.ts`,
				],
				{
					stdio: "pipe",
					encoding: "utf8",
					env: { ...process.env, TSX_TSCONFIG_PATH: "./tsconfig.test.json" },
				},
			),
		);
	});
});
