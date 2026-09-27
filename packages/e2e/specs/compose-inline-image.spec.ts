import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	type MimeShape,
	readMimeShape,
	readMimeShapeOfRaw,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

const SCREENSHOT = {
	name: "chart.png",
	mimeType: "image/png",
	base64:
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
};

const imagePart = (shape: MimeShape) =>
	shape.parts.find((part) => part.contentType === SCREENSHOT.mimeType);

const htmlPart = (shape: MimeShape) =>
	shape.parts.find((part) => part.contentType === "text/html");

const expectInline = (shape: MimeShape): string => {
	const image = imagePart(shape);
	expect(image).toMatchObject({
		filename: SCREENSHOT.name,
		disposition: "inline",
		content: Buffer.from(SCREENSHOT.base64, "base64").toString("utf8"),
	});
	const contentId = image?.contentId?.replace(/^<|>$/g, "") ?? "";
	expect(contentId).toMatch(/@remit$/);
	expect(htmlPart(shape)?.content).toContain(`src="cid:${contentId}"`);
	return contentId;
};

test.describe("Pasting an image into a message (#1307)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Compose Inline Image");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});

		await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("the pasted image goes out inline, referred to from the body by its content-id", async () => {
		test.setTimeout(300_000);

		const page = await context.newPage();
		const subject = `Compose inline image ${Date.now()}`;

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);
		await body.click();
		await page.keyboard.type("The chart is below.");

		await body.evaluate((element, screenshot) => {
			const bytes = Uint8Array.from(atob(screenshot.base64), (character) =>
				character.charCodeAt(0),
			);
			const clipboard = new DataTransfer();
			clipboard.items.add(
				new File([bytes], screenshot.name, { type: screenshot.mimeType }),
			);
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					clipboardData: clipboard,
					bubbles: true,
					cancelable: true,
				}),
			);
		}, SCREENSHOT);

		await expect(body.locator("img")).toHaveCount(1);
		await expect(
			page
				.getByTestId("compose-attachment")
				.filter({ hasText: SCREENSHOT.name }),
		).toHaveAttribute("data-state", "attached", { timeout: 30_000 });

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(body).toBeHidden({ timeout: 30_000 });

		const accepted = await waitForAcceptedMessage(subject);
		const wireContentId = expectInline(await readMimeShapeOfRaw(accepted.raw));

		const filed = await waitFor(
			() => readMimeShape(run.imapUser, "Sent", subject),
			(shape) => shape !== null,
			{ timeoutMs: 120_000, what: "the Sent copy to be filed on the server" },
		);
		if (!filed)
			throw new Error("unreachable: the Sent copy was matched as present");
		expect(expectInline(filed)).toBe(wireContentId);
	});
});
