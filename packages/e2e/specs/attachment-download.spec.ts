/**
 * Issue #683 — an attachment on a received message could not be opened. The
 * read path existed end to end; nothing in the UI enumerated the attachment
 * parts, and the paperclip that looked like the control was an inert span.
 *
 * The bytes are what makes this a regression test rather than a rendering one:
 * the file the browser writes is compared against the file that was APPENDed to
 * Dovecot, so a pass means the whole chain held — BODYSTRUCTURE, part storage,
 * the content route, the fetch, and the save.
 *
 * The fixture is scratch, appended here and deleted on the way out, because the
 * serial suite asserts the shared inbox holds exactly `seededSubjects`.
 */
import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import {
	ATTACHMENT_HOSTILE,
	ATTACHMENT_PDF,
	attachmentMessage,
} from "../src/attachment-fixture.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { type RunState, readRunState } from "../src/state.js";

const TAG = `attachment-fixture ${Date.now()}`;
const SUBJECT = `${TAG} board pack`;

let run: RunState;
let api: ApiClient;

const rows = (page: Page): Locator =>
	page.locator("a[href*='selectedMessageId']");

const gotoInbox = async (page: Page): Promise<void> => {
	await page.goto(`/mail/${run.inboxId}`);
	await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
};

/** The scratch message's row, once the sync that carries it has landed. */
const fixtureRow = async (page: Page): Promise<Locator> => {
	await expect(async () => {
		await page.reload();
		await expect(rows(page).filter({ hasText: SUBJECT })).toHaveCount(1, {
			timeout: 5_000,
		});
	}).toPass({ timeout: 90_000 });
	return rows(page).filter({ hasText: SUBJECT });
};

const openFixture = async (page: Page): Promise<Locator> => {
	await gotoInbox(page);
	const row = await fixtureRow(page);
	await row.click();
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

test.beforeAll(async () => {
	run = readRunState();
	api = new ApiClient(run);
	await appendMessages(run.imapUser, [attachmentMessage(SUBJECT)]);
	await api.triggerSync(run.accountId);
});

test.afterAll(async () => {
	for (const mailbox of await api.listMailboxes(run.accountId)) {
		const ids = await api.searchMatchingMessageIds(mailbox.mailboxId, TAG);
		if (ids.length > 0) await api.deleteMessages(ids);
	}
});

test.describe("Attachments on a received message", () => {
	test("every attachment is listed with its name, type and size", async ({
		page,
	}) => {
		const list = await openFixture(page);

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
		const list = await openFixture(page);

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
		const list = await openFixture(page);

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
		await gotoInbox(page);
		const row = await fixtureRow(page);

		await expect(
			row.getByRole("img", { name: "Has an attachment" }),
		).toHaveCount(1);
	});
});
