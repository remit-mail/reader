import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { randomId } from "../id.js";
import type { OpenTestStores } from "../test-stores.js";
import { AccountExportRequestRepo } from "./i4-account-export-request.js";

export const accountExportRequestRepoSuite = (open: OpenTestStores): void => {
	describe("AccountExportRequestRepo", () => {
		let close: () => Promise<void>;
		let repo: AccountExportRequestRepo;

		before(async () => {
			const opened = await open();
			close = opened.close;
			repo = new AccountExportRequestRepo(opened.stores.app.db);
		});

		after(async () => {
			await close();
		});

		describe("continuation token rejection (#172)", () => {
			for (const [label, token] of [
				["an unparseable", "not-a-cursor"],
				["a bare number", Buffer.from("123").toString("base64url")],
				["a JSON array", Buffer.from("[1,2]").toString("base64url")],
			] as const) {
				test(`${label} token is rejected as a 400`, async () => {
					await assert.rejects(
						() =>
							repo.listByAccountConfig(randomId(), {
								continuationToken: token,
							}),
						(error: unknown) => {
							assert.equal((error as { statusCode?: number }).statusCode, 400);
							assert.equal((error as Error).name, "BadRequestError");
							return true;
						},
					);
				});
			}
		});
	});
};
