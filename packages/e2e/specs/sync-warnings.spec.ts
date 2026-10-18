import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient, type SyncWarning, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	createServerMailbox,
	expungeServerMessage,
	listServerMailboxes,
	serverUidsForSubject,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { enqueueBodySync } from "../src/queue.js";

const STAMP = Date.now();
const FOLDER = `Flaky ${STAMP}`;
const SUBJECT = `Body that vanished ${STAMP}`;
const FAILED_ROUNDS = 3;

const settingsButton = (page: Page) =>
	page.getByRole("button", { name: /^Settings/ });

test.describe("A message whose body fails to sync", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;
	let mailboxId: string;
	let uid: number;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		run = await provisionIsolatedRun("E2E Sync warnings");
		api = new ApiClient(run);

		await createServerMailbox(run.imapUser, FOLDER);
		await appendMessages(run.imapUser, [{ subject: SUBJECT }], FOLDER);
		[uid] = await serverUidsForSubject(run.imapUser, FOLDER, SUBJECT);

		await api.triggerSync(run.accountId);
		const boxes = await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === FOLDER),
			{ timeoutMs: 90_000, what: `"${FOLDER}" to reach the read model` },
		);
		const folder = boxes.find((box) => box.fullPath === FOLDER);
		if (!folder) throw new Error("unreachable: folder matched but not found");
		mailboxId = folder.mailboxId;

		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("lights the dot and lists the warning, then clears both once a sync finds the message gone", async () => {
		test.setTimeout(300_000);
		const messageId = await api.messageIdForSubject(mailboxId, SUBJECT);
		const noWarning = await api.listWarnings();
		expect(noWarning.warnings).toEqual([]);

		await expungeServerMessage(run.imapUser, FOLDER, SUBJECT);
		expect(await serverUidsForSubject(run.imapUser, FOLDER, SUBJECT)).toEqual(
			[],
		);

		for (let round = 0; round < FAILED_ROUNDS; round++) {
			await enqueueBodySync(run.accountId, mailboxId, [messageId]);
		}

		const isOurs = (warning: SyncWarning): boolean =>
			warning.mailboxId === mailboxId && warning.uid === uid;
		const listed = await waitFor(
			() => api.listWarnings(),
			(list) => list.warnings.some(isOurs),
			{
				timeoutMs: 120_000,
				what: `a Body warning for uid ${uid} after ${FAILED_ROUNDS} failed rounds`,
			},
		);
		const warning = listed.warnings.find(isOurs);
		expect(warning?.stage).toBe("Body");
		expect(warning?.attempts).toBeGreaterThanOrEqual(FAILED_ROUNDS);

		const page = await context.newPage();
		await page.goto("/mail/flagged");
		await expect(settingsButton(page)).toHaveAccessibleName(
			"Settings — Sync warnings",
			{ timeout: 30_000 },
		);

		await page.goto("/settings/warnings");
		await expect(page.getByText(FOLDER).first()).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText("Gave up").first()).toBeVisible();

		await api.syncPastMailbox(run.accountId, FOLDER);
		await waitFor(
			() => api.listWarnings(),
			(list) => list.warnings.length === 0 && list.entries.length === 0,
			{ timeoutMs: 60_000, what: "the warning list to clear" },
		);

		await page.goto("/mail/flagged");
		await expect(settingsButton(page)).toHaveAccessibleName("Settings", {
			timeout: 30_000,
		});

		await page.goto("/settings/warnings");
		await expect(page.getByText(/Every message is syncing/)).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText(FOLDER)).toHaveCount(0);
		expect(await listServerMailboxes(run.imapUser)).toContain(FOLDER);
		expect(
			(await api.listMailboxes(run.accountId)).some(
				(box) => box.fullPath === FOLDER,
			),
		).toBe(true);
		await page.close();
	});
});
