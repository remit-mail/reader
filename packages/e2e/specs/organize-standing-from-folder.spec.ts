/**
 * A standing rule made from mail outside the inbox still files that mail.
 *
 * A new filter's first pass runs over the inbox (#1354), as index time would
 * for mail arriving now. Mail the user ticked in another folder is not the
 * pass's to reach, so the wizard takes the action on those rows directly. This
 * lane seeds a folder, makes a rule from two of its messages, and checks on the
 * mail server that both left the folder for the rule's destination.
 *
 * Runs as its own throwaway user (src/provision.ts): the flow files a filter and
 * two folders that would otherwise disturb the shared onboarded account.
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
	barOrganize,
	commitButton,
	pickFolder,
	pickMatchDoor,
	wizardStep,
} from "../src/wizard.js";

const DESKTOP = { width: 1512, height: 864 };

const STAMP = Date.now();
const SENDER = `kept-${STAMP}@example.com`;
const SOURCE = `E2E Kept ${STAMP}`;
const DESTINATION = `E2E Filed ${STAMP}`;
const RULE_NAME = `E2E Folder rule ${STAMP}`;
const SUBJECTS = [1, 2].map((n) => `E2E Folder ${STAMP} #${n}`);

test.describe("Standing filter made outside the inbox", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Standing From Folder");
		api = new ApiClient(run);
	});

	test("files the ticked mail from the folder it was made in", async ({
		browser,
	}) => {
		test.setTimeout(900_000);

		await createServerMailbox(run.imapUser, SOURCE);
		await createServerMailbox(run.imapUser, DESTINATION);
		await appendMessages(
			run.imapUser,
			SUBJECTS.map((subject) => ({
				subject,
				from: `Kept Sender <${SENDER}>`,
			})),
			SOURCE,
		);

		const boxes = await waitFor(
			async () => {
				await api.triggerSync(run.accountId).catch(() => undefined);
				return api.listMailboxes(run.accountId);
			},
			(list) =>
				(list.find((b) => b.fullPath === SOURCE)?.messageCount ?? 0) >=
					SUBJECTS.length &&
				list.some(
					(b) => b.fullPath === DESTINATION && b.syncStatus === "synced",
				),
			{
				timeoutMs: 300_000,
				intervalMs: 4_000,
				what: "the seed to reach its folder and the destination to settle",
			},
		);
		const source = boxes.find((b) => b.fullPath === SOURCE);
		if (!source) throw new Error("unreachable: source matched but not found");

		const context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
		const page = await context.newPage();

		try {
			await page.goto(`/mail/${source.mailboxId}`);
			const rows = page.locator("[data-message-row]");
			const row = (subject: string) => rows.filter({ hasText: subject });
			await expect(row(SUBJECTS[0])).toBeVisible({ timeout: 60_000 });

			await row(SUBJECTS[0]).click({ modifiers: ["ControlOrMeta"] });
			await row(SUBJECTS[1]).click({ modifiers: ["ControlOrMeta"] });

			await barOrganize(page).click();
			await expect(wizardStep(page)).toHaveText(/^Step 1 of 5 · Apply to$/, {
				timeout: 30_000,
			});
			await pickMatchDoor(page, "Its properties");
			await advanceTo(page, "Properties");
			await advanceTo(page, "Folder");
			await pickFolder(page, DESTINATION);
			await advanceTo(page, "Rule");
			await page.getByText("Keep doing this", { exact: true }).click();
			await advanceTo(page, "Name");
			await page.getByLabel("Rule name").fill(RULE_NAME);
			await advanceTo(page, "Review");

			await commitButton(page, "Save rule").click();
			await expect(wizardStep(page)).toHaveText(/· Run$/, {
				timeout: 30_000,
			});
		} finally {
			await context.close();
		}

		await waitForServerMailbox(
			run.imapUser,
			DESTINATION,
			(subjects) => SUBJECTS.every((subject) => subjects.includes(subject)),
			{
				timeoutMs: 180_000,
				what: `the ticked mail to be filed into "${DESTINATION}"`,
			},
		);
		await waitForServerMailbox(
			run.imapUser,
			SOURCE,
			(subjects) => SUBJECTS.every((subject) => !subjects.includes(subject)),
			{
				timeoutMs: 60_000,
				what: `the ticked mail to leave "${SOURCE}"`,
			},
		);
	});
});
