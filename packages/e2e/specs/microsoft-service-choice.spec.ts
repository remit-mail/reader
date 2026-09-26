import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };
const CALENDAR_SCOPE = "https://graph.microsoft.com/Calendars.Read";
const IMAP_SCOPE = "https://outlook.office.com/IMAP.AccessAsUser.All";

const consentCode = (scope: string, email: string): string =>
	Buffer.from(JSON.stringify({ scope, email })).toString("base64url");

const answerMicrosoft = async (
	page: Page,
	email: string,
	grant: (requested: string[]) => string[],
): Promise<{ requested: string[] }> => {
	const seen = { requested: [] as string[] };
	await page.route("https://login.microsoftonline.com/**", async (route) => {
		const authorize = new URL(route.request().url());
		seen.requested = (authorize.searchParams.get("scope") ?? "").split(" ");
		const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
		callback.searchParams.set(
			"code",
			consentCode(grant(seen.requested).join(" "), email),
		);
		callback.searchParams.set(
			"state",
			authorize.searchParams.get("state") ?? "",
		);
		await route.fulfill({
			status: 302,
			headers: { location: callback.toString() },
		});
	});
	return seen;
};

const signInForCalendarOnly = async (page: Page): Promise<void> => {
	await page.goto("/settings/accounts");
	await page.getByRole("button", { name: "Add account" }).first().click();
	await page.getByText("Outlook / Microsoft 365").click();
	await page.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(page.getByText("What should Remit sync?")).toBeVisible();
	await page.getByRole("checkbox", { name: /^Mail/ }).uncheck();
	await expect(page.getByRole("checkbox", { name: /^Calendar/ })).toBeChecked();
	await page.getByRole("button", { name: "Sign in with Microsoft" }).click();
};

test.describe("Onboarding a Microsoft account for its calendar alone", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		run = await provisionIsolatedRun("E2E Microsoft Services");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("asks Microsoft for the calendar only and records the granted scope", async () => {
		test.setTimeout(120_000);
		const page = await context.newPage();
		const email = `outlook-${Date.now()}@outlook.e2e`;
		const microsoft = await answerMicrosoft(page, email, (requested) =>
			requested.filter((scope) => scope.includes("://")),
		);

		await signInForCalendarOnly(page);

		await expect(page.getByText(`Connected ${email}`)).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByTestId("granted-scopes")).toHaveText(CALENDAR_SCOPE);
		expect(microsoft.requested).toContain(CALENDAR_SCOPE);
		expect(microsoft.requested).not.toContain(IMAP_SCOPE);

		const config = await api.getConfig();
		const account = config.accounts.find(
			(candidate) => candidate.email === email,
		);
		expect(account?.syncedServices).toEqual(["Calendar"]);
		expect(account?.grantedScopes).toEqual([CALENDAR_SCOPE]);

		await page.getByRole("button", { name: "Continue" }).click();
		await expect(
			page.getByText("Account connected successfully."),
		).toBeVisible();
	});

	test("says Microsoft withheld the calendar and keeps no account", async () => {
		test.setTimeout(120_000);
		const page = await context.newPage();
		const email = `outlook-denied-${Date.now()}@outlook.e2e`;
		await answerMicrosoft(page, email, () => []);

		await signInForCalendarOnly(page);

		await expect(
			page.getByText(/did not grant access to every service you picked/),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("button", { name: "Sign in with Microsoft" }),
		).toBeEnabled();

		const config = await api.getConfig();
		expect(config.accounts.map((account) => account.email)).not.toContain(
			email,
		);
	});
});
