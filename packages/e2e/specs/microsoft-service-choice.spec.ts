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

const signInForCalendarOnly = async (
	page: Page,
	email?: string,
): Promise<void> => {
	await page.goto("/settings/accounts");
	await page.getByRole("button", { name: "Add account" }).first().click();
	await page.getByText("Outlook / Microsoft 365").click();
	await page.getByRole("button", { name: "Continue with Microsoft" }).click();
	await expect(page.getByText("What should Remit sync?")).toBeVisible();
	await page.getByRole("checkbox", { name: /^Mail/ }).uncheck();
	await expect(page.getByRole("checkbox", { name: /^Calendar/ })).toBeChecked();
	if (email) await page.getByLabel("Email address (optional)").fill(email);
	await page.getByRole("button", { name: "Sign in with Microsoft" }).click();
};

test.describe("Onboarding a Microsoft account for its calendar alone", () => {
	test.describe.configure({ mode: "serial" });
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

	const email = `outlook-${Date.now()}@outlook.e2e`;

	test("asks Microsoft for the calendar only and records the granted scope", async () => {
		test.setTimeout(120_000);
		const page = await context.newPage();
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
		const deniedEmail = `outlook-denied-${Date.now()}@outlook.e2e`;
		await answerMicrosoft(page, deniedEmail, () => []);

		await signInForCalendarOnly(page);

		await expect(
			page.getByText(/Microsoft did not grant access to Calendar\./),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByLabel("Email address (optional)")).toHaveValue(
			deniedEmail,
		);
		await expect(
			page.getByRole("button", { name: "Sign in with Microsoft" }),
		).toBeEnabled();

		const config = await api.getConfig();
		expect(config.accounts.map((account) => account.email)).not.toContain(
			deniedEmail,
		);
	});

	test("a reconnect of the calendar account ends on the granted screen", async () => {
		test.setTimeout(120_000);
		const page = await context.newPage();
		const before = await api.getConfig();
		const connected = before.accounts.find(
			(candidate) => candidate.email === email,
		);
		expect(connected).toBeDefined();
		await answerMicrosoft(page, email, (requested) =>
			requested.filter((scope) => scope.includes("://")),
		);

		await signInForCalendarOnly(page, email);

		await expect(page.getByText(`Connected ${email}`)).toBeVisible({
			timeout: 30_000,
		});
		const after = await api.getConfig();
		expect(
			after.accounts.filter((candidate) => candidate.email === email),
		).toHaveLength(1);
		expect(
			after.accounts.find((candidate) => candidate.email === email)?.accountId,
		).toBe(connected?.accountId);
	});

	test("a reconnect Microsoft refused the calendar reopens that account", async () => {
		test.setTimeout(120_000);
		const page = await context.newPage();
		await answerMicrosoft(page, email, () => []);

		await signInForCalendarOnly(page, email);

		await expect(page.getByText(`Reconnect ${email}`)).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			page.getByText(/Microsoft did not grant access to Calendar\./),
		).toBeVisible();
		await expect(page.getByLabel("Email address (optional)")).toHaveValue(
			email,
		);
		const account = (await api.getConfig()).accounts.find(
			(candidate) => candidate.email === email,
		);
		expect(account?.grantedScopes).toEqual([CALENDAR_SCOPE]);
	});
});
