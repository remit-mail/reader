import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };

const NOT_CONFIGURED_NOTE = "Save a provider below first";
const SAVED_OFF_NOTE = "Provider saved. Built-in rules label your mail";
const ON_NOTE = "New mail goes to the model";

const savedClassificationState = async (api: ApiClient): Promise<string> => {
	const response = await api.request("GET", "/settings");
	expect(response.status).toBe(200);
	const body: { classification: { state: string } } = await response.json();
	return body.classification.state;
};

const providerSelect = (page: Page) =>
	page.getByLabel("Provider", { exact: true });

const modelSwitch = (page: Page) =>
	page.getByRole("switch", { name: "Use the model" });

const save = (page: Page) =>
	page.getByRole("button", { name: "Save", exact: true }).click();

test.describe("Mail classification settings (#1532)", () => {
	test.describe.configure({ mode: "serial" });

	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;
	let page: Page;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Classification Settings");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
		page = await context.newPage();
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("the page opens from the settings nav with no provider saved", async () => {
		await page.goto("/settings/accounts");
		await page
			.getByRole("button", { name: "Mail classification", exact: true })
			.click();

		await expect(page).toHaveURL(/\/settings\/classification$/);
		await expect(page.getByText(NOT_CONFIGURED_NOTE)).toBeVisible({
			timeout: 30_000,
		});
		await expect(modelSwitch(page)).toHaveAttribute("aria-checked", "false");
		await expect(modelSwitch(page)).toHaveAttribute("aria-disabled", "true");
		expect(await savedClassificationState(api)).toBe("NotConfigured");
	});

	test("the Local preset saves without a key and survives a reload", async () => {
		await providerSelect(page).selectOption({ label: "Local" });
		await expect(page.getByText("No key needed.")).toBeVisible();
		await expect(page.getByLabel("API key", { exact: true })).toHaveCount(0);

		await save(page);
		await expect(page.getByText(SAVED_OFF_NOTE)).toBeVisible({
			timeout: 15_000,
		});
		await expect(modelSwitch(page)).toHaveAttribute("aria-disabled", "false");

		await page.reload();
		await expect(providerSelect(page)).toHaveValue("Local", {
			timeout: 30_000,
		});
		await expect(page.getByText(SAVED_OFF_NOTE)).toBeVisible();
		expect(await savedClassificationState(api)).toBe("Configured");
	});

	test("the switch turns the model on and off again", async () => {
		await modelSwitch(page).click();
		await expect(modelSwitch(page)).toHaveAttribute("aria-checked", "true", {
			timeout: 15_000,
		});
		await expect(page.getByText(ON_NOTE)).toBeVisible();

		await page.reload();
		await expect(modelSwitch(page)).toHaveAttribute("aria-checked", "true", {
			timeout: 30_000,
		});

		await modelSwitch(page).click();
		await expect(modelSwitch(page)).toHaveAttribute("aria-checked", "false", {
			timeout: 15_000,
		});
		await expect(page.getByText(SAVED_OFF_NOTE)).toBeVisible();
	});

	test("picking another preset warns, and a bad base URL or a missing key stops the save", async () => {
		await providerSelect(page).selectOption({
			label: "OpenAI-compatible endpoint",
		});
		await expect(page.getByText("Saving switches from Local.")).toBeVisible();

		const baseUrlField = page.getByLabel("Base URL", { exact: true });
		await baseUrlField.fill("ftp://classifier.remit.test");
		await save(page);
		await expect(
			page.getByText("Enter a URL that starts with http:// or https://"),
		).toBeVisible();
		await expect(baseUrlField).toBeFocused();

		await baseUrlField.fill("http://classifier.remit.test/v1");
		await save(page);
		const keyField = page.getByLabel("API key", { exact: true });
		await expect(page.getByText("Paste an API key")).toBeVisible();
		await expect(keyField).toBeFocused();
		expect(await savedClassificationState(api)).toBe("Configured");

		await keyField.fill("e2e-classification-key");
		await save(page);
		await expect(page.getByText("set", { exact: true })).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByRole("button", { name: "Replace", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Saving switches from")).toHaveCount(0);

		await page.reload();
		await expect(providerSelect(page)).toHaveValue("OpenAiCompatible", {
			timeout: 30_000,
		});
		await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(
			"http://classifier.remit.test/v1",
		);
		await expect(page.getByText("set", { exact: true })).toBeVisible();
	});

	test("clearing the key after confirming leaves no provider saved", async () => {
		const clear = page.getByRole("button", { name: "Clear", exact: true });
		await clear.click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("Clear the provider settings?");
		await expect(dialog).toContainText(
			"Clearing the provider returns every field to the deployment default.",
		);
		await dialog.getByRole("button", { name: "Clear", exact: true }).click();

		await expect(page.getByText(NOT_CONFIGURED_NOTE)).toBeVisible({
			timeout: 15_000,
		});
		await expect(modelSwitch(page)).toHaveAttribute("aria-disabled", "true");
		await expect(page.getByText("set", { exact: true })).toHaveCount(0);
		expect(await savedClassificationState(api)).toBe("NotConfigured");

		await page.reload();
		await expect(page.getByText(NOT_CONFIGURED_NOTE)).toBeVisible({
			timeout: 30_000,
		});
	});
});
