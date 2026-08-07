/**
 * Issue #683 — an attachment on a received message could not be opened. The
 * read path existed end to end; nothing in the UI enumerated the attachment
 * parts, and the paperclip that looked like the control was an inert span.
 *
 * The bytes are what makes this a regression test rather than a rendering one:
 * the file the browser writes is compared against the file that was APPENDed to
 * Dovecot before the account existed, so a pass means the whole chain held —
 * BODYSTRUCTURE, part storage, the content route, the fetch, and the save.
 */
import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import {
	ATTACHMENT_HOSTILE,
	ATTACHMENT_PDF,
	ATTACHMENT_SUBJECT,
} from "../src/attachment-fixture.js";
import { expect, test } from "../src/fixtures.js";

const openAttachmentMessage = async (page: Page): Promise<Locator> => {
	await page.goto("/mail");
	const sidebar = page.getByRole("navigation", {
		name: "Mailboxes",
		exact: true,
	});
	await expect(sidebar).toBeVisible({ timeout: 20_000 });
	await sidebar.getByRole("link", { name: /inbox/i }).click();
	await page.waitForURL(/\/mail\/[a-z0-9]+/);

	await page
		.getByText(ATTACHMENT_SUBJECT, { exact: true })
		.first()
		.click({ timeout: 30_000 });
	await page.waitForURL(/selectedMessageId=/);

	const article = page.getByRole("article");
	await expect(article).toBeVisible({ timeout: 15_000 });

	const list = article.getByTestId("attachment-list");
	await expect(list).toBeVisible({ timeout: 30_000 });
	return list;
};

const downloadedText = async (
	page: Page,
	trigger: Locator,
): Promise<{ filename: string; content: string }> => {
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		trigger.click(),
	]);
	const path = await download.path();
	return {
		filename: download.suggestedFilename(),
		content: readFileSync(path, "utf8"),
	};
};

test.describe("Attachments on a received message", () => {
	test("every attachment is listed with its name, type and size", async ({
		page,
	}) => {
		const list = await openAttachmentMessage(page);

		await expect(list.getByRole("heading")).toHaveText("2 attachments");
		await expect(
			list.getByText(ATTACHMENT_PDF.filename, { exact: true }),
		).toBeVisible();
		await expect(
			list.getByText(ATTACHMENT_HOSTILE.sanitizedFilename, { exact: true }),
		).toBeVisible();
		await expect(list.getByText(/^PDF · \d+ bytes$/)).toBeVisible();
	});

	test("downloading an attachment writes the bytes that were sent", async ({
		page,
	}) => {
		const list = await openAttachmentMessage(page);

		const result = await downloadedText(
			page,
			list.getByRole("button", {
				name: `Download ${ATTACHMENT_PDF.filename}`,
			}),
		);

		expect(result.filename).toBe(ATTACHMENT_PDF.filename);
		expect(result.content).toBe(ATTACHMENT_PDF.content);
	});

	// The sender chose `../../../etc/passwd`. Both the label and the saved file
	// have to be the final segment, or the list is telling the user one thing
	// while the browser does another.
	test("a filename that tries to escape the download directory is reduced to its basename", async ({
		page,
	}) => {
		const list = await openAttachmentMessage(page);

		const result = await downloadedText(
			page,
			list.getByRole("button", {
				name: `Download ${ATTACHMENT_HOSTILE.sanitizedFilename}`,
			}),
		);

		expect(result.filename).toBe(ATTACHMENT_HOSTILE.sanitizedFilename);
		expect(result.content).toBe(ATTACHMENT_HOSTILE.content);
	});

	// The list row cannot download anything, so its paperclip is metadata and
	// announces itself as such. The control the issue was reported against lives
	// in the open message, and is a real button.
	test("the list row announces the attachment as metadata, not as a control", async ({
		page,
	}) => {
		await page.goto("/mail");
		const sidebar = page.getByRole("navigation", {
			name: "Mailboxes",
			exact: true,
		});
		await expect(sidebar).toBeVisible({ timeout: 20_000 });
		await sidebar.getByRole("link", { name: /inbox/i }).click();
		await page.waitForURL(/\/mail\/[a-z0-9]+/);

		const row = page
			.locator("a[href*='selectedMessageId']")
			.filter({ hasText: ATTACHMENT_SUBJECT });
		await expect(row).toHaveCount(1, { timeout: 30_000 });
		await expect(
			row.getByRole("img", { name: "Has an attachment" }),
		).toHaveCount(1);
	});
});
