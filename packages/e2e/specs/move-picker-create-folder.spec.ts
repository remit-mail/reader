/**
 * Creating a folder from the move picker (PR #282). Move on the selection bar
 * opens the wizard, and its folder step offers a "New folder" row that names,
 * creates and takes the folder as the destination; the review screen is what
 * commits the move.
 *
 * This drives that row against the real build and backend: the message lands in
 * a folder that did not exist when the run started, and the folder is real.
 * Server-side folder truth is covered by folder-lifecycle.spec.ts; here the
 * check is that the create-and-move wiring works end to end through the API.
 *
 * Runs as its own throwaway user (see `src/provision.ts`): its cleanup deletes a
 * folder that has held mail, which parks that account's message queue (#287), so it
 * must not be the shared onboarded account other specs read. A fresh account's
 * inbox holds only the one message this spec appends, so the message is
 * selectable without a search.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	advanceTo,
	barMove,
	commitButton,
	createFolderInPicker,
	dismissRun,
	wizardStep,
} from "../src/wizard.js";

const DESKTOP = { width: 1512, height: 864 };

const STAMP = Date.now();
const SUBJECT = `Move picker create ${STAMP}`;
const FOLDER_NAME = `E2E Picker ${STAMP}`;

const rows = (page: Page) => page.locator("[data-message-row]");

test.describe("Create folder from the move picker", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		run = await provisionIsolatedRun("E2E Move Picker");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		const boxes = await api.listMailboxes(run.accountId);
		for (const box of boxes.filter((b) => b.fullPath === FOLDER_NAME)) {
			await api.deleteMailbox(run.accountId, box.mailboxId);
		}
		await context.close();
	});

	test("the picker's create row moves the message into a brand-new folder", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		await appendMessages(run.imapUser, [
			{ subject: SUBJECT, body: `Body of ${SUBJECT}.` },
		]);
		// Paced sync trigger: one trigger can race the folder's first sync, and
		// overlapping syncs on the account's ordered queue race each other.
		const deadline = Date.now() + 120_000;
		let landed = false;
		while (Date.now() < deadline) {
			await api.triggerSync(run.accountId).catch(() => undefined);
			landed = await waitFor(
				() => api.listThreads(run.inboxId),
				(threads) => threads.some((t) => t.subject === SUBJECT),
				{ timeoutMs: 30_000, intervalMs: 3_000, what: "the message to sync" },
			)
				.then(() => true)
				.catch(() => false);
			if (landed) break;
		}
		expect(landed).toBe(true);

		// The fresh account's inbox holds only this message; select it without a
		// search, without navigating into it.
		await page.goto(`/mail/${run.inboxId}`);
		await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
		await rows(page)
			.first()
			.click({ modifiers: ["ControlOrMeta"] });

		await barMove(page).click();
		await expect(wizardStep(page)).toHaveText(/^Step 1 of 4 · Apply to$/, {
			timeout: 20_000,
		});
		await advanceTo(page, "Folder");

		await expect(
			page.getByRole("searchbox", { name: "Filter folders" }),
		).toBeVisible({ timeout: 10_000 });
		await createFolderInPicker(page, FOLDER_NAME);

		// The created folder is the destination only once the mail server has
		// confirmed it, which is what the step waits for.
		await expect(page.getByText(`Moving to ${FOLDER_NAME}.`)).toBeVisible({
			timeout: 60_000,
		});

		await advanceTo(page, "Review");
		await commitButton(page, "Move").click();
		await expect(page.getByText("Moved 1")).toBeVisible({ timeout: 60_000 });
		await dismissRun(page);

		// Selection ends when the move runs.
		await expect(barMove(page)).toBeHidden({ timeout: 60_000 });

		// The folder is real and holds the message — the create-and-move ran on
		// the backend, not just the optimistic cache.
		const folder = await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((b) => b.fullPath === FOLDER_NAME),
			{ timeoutMs: 30_000, what: `the folder "${FOLDER_NAME}" to be created` },
		).then((boxes) => {
			const match = boxes.find((b) => b.fullPath === FOLDER_NAME);
			if (!match) throw new Error("unreachable: folder matched but not found");
			return match;
		});

		await waitFor(
			() => api.listThreads(folder.mailboxId),
			(threads) => threads.some((t) => t.subject === SUBJECT),
			{ timeoutMs: 90_000, what: "the message to land in the created folder" },
		);
	});
});
