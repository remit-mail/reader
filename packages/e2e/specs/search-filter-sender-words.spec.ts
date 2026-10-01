/**
 * A filter made from a free-text search keeps the mail that search showed.
 *
 * The reported path: "Austrian airlines" found inbox mail on the sender's
 * display name alone, the user made a filter from the search with a move, and
 * the first pass over the inbox reported 0 of 0. Search requires every word
 * anywhere in subject, sender or body; the filter's "has the words" clause now
 * matches the same way, so the pass files the message search found.
 *
 * Runs as its own throwaway user (src/provision.ts): the flow files a filter and
 * a folder that would otherwise disturb the shared onboarded account.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	createServerMailbox,
	waitForServerMailbox,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	advanceTo,
	commitButton,
	pickFolder,
	wizardStep,
} from "../src/wizard.js";

const TABLET = { width: 800, height: 1106 };

const STAMP = Date.now();
const SUBJECT = `Your trip to Vienna ${STAMP}`;
const DESTINATION = `E2E Travel ${STAMP}`;
const RULE_NAME = `E2E Sender words ${STAMP}`;

test.describe("Filter made from a free-text search", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Search Filter Sender Words");
		api = new ApiClient(run);
	});

	test("files inbox mail whose sender name carries the searched words", async ({
		browser,
	}) => {
		test.setTimeout(900_000);

		await createServerMailbox(run.imapUser, DESTINATION);
		await appendMessages(run.imapUser, [
			{
				subject: SUBJECT,
				from: `Austrian Airlines Booking <booking-${STAMP}@example.com>`,
				body: "Check in opens 24 hours before departure.",
			},
		]);

		await waitFor(
			async () => {
				await api.triggerSync(run.accountId).catch(() => undefined);
				return api.listMailboxes(run.accountId);
			},
			(list) =>
				(list.find((b) => b.mailboxId === run.inboxId)?.messageCount ?? 0) >=
					1 &&
				list.some(
					(b) => b.fullPath === DESTINATION && b.syncStatus === "synced",
				),
			{
				timeoutMs: 300_000,
				intervalMs: 4_000,
				what: "the seed to reach the inbox and the destination to settle",
			},
		);

		const context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: TABLET,
		});
		const page = await context.newPage();

		try {
			await page.goto("/mail");
			await expect(page.locator("[data-selection-bar]")).toBeVisible({
				timeout: 30_000,
			});
			await page.getByRole("button", { name: "Search", exact: true }).click();
			await page.getByLabel("Search mail").fill("Austrian airlines");

			const makeFilter = page.getByRole("button", {
				name: "Make this a filter",
			});
			await expect(makeFilter).toBeVisible({ timeout: 20_000 });
			await makeFilter.click();
			await expect(wizardStep(page)).toHaveText(/^Step 1 of 5 · Properties$/, {
				timeout: 20_000,
			});

			await advanceTo(page, "Folder");
			await pickFolder(page, DESTINATION);
			await advanceTo(page, "Rule");
			await page.getByText("Keep doing this", { exact: true }).click();
			await advanceTo(page, "Name");
			await page.getByLabel("Rule name").fill(RULE_NAME);
			await advanceTo(page, "Review");

			await commitButton(page, "Save rule").click();
			await expect(page.getByText("Rule saved and applied")).toBeVisible({
				timeout: 180_000,
			});
			await expect(
				page.getByText(/^1 of 1 already in your mailbox organized\./),
			).toBeVisible();
		} finally {
			await context.close();
		}

		await waitForServerMailbox(
			run.imapUser,
			DESTINATION,
			(subjects) => subjects.includes(SUBJECT),
			{
				timeoutMs: 180_000,
				what: `the searched mail to be filed into "${DESTINATION}"`,
			},
		);
	});
});
