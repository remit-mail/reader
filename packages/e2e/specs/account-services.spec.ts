import { expect, test } from "../src/fixtures.js";

test.describe("What an account syncs", () => {
	test("the API refuses calendar on an IMAP account, and settings offers it no switch", async ({
		api,
		page,
		run,
	}) => {
		const response = await api.request("PATCH", `/accounts/${run.accountId}`, {
			syncedServices: ["Mail", "Calendar"],
		});
		expect(response.status).toBe(400);

		const config = await api.getConfig();
		const account = config.accounts.find(
			(candidate) => candidate.accountId === run.accountId,
		);
		expect(account?.syncedServices).toEqual(["Mail"]);

		await page.goto("/settings/accounts");
		await expect(
			page.getByRole("button", { name: "Manage" }).first(),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("switch", { name: "Sync calendar" }),
		).toHaveCount(0);
	});
});
