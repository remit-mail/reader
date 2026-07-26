/**
 * Creating a standing filter moves the mail that already matches, not only the
 * mail that arrives next — verified against the IMAP server, not the app's cache.
 *
 * The exact reported flow: a selection is organized into a rule, a fresh folder
 * is created from within the rule editor's destination affordance, and the rule
 * is saved with "Keep doing this". Two defects meet here — the standing scope
 * used to skip the retroactive back-apply, and a folder created this way could be
 * left dangling when the server normalized its path — so the proof is on Dovecot:
 * every already-matching message lands in the new folder and every non-matching
 * one stays put.
 *
 * The widen is a semantic query and the vector index is deliberately not built on
 * the e2e lane (see organize-standing-filter.spec.ts), so the editor opens on the
 * sender fallback: the selected messages' `From` address becomes the rule's only
 * clause, matched literally. That is the whole point of seeding by sender — the
 * match is real, evaluated server-side over the corpus, no embedder involved.
 *
 * Runs as its own throwaway user (src/provision.ts): the back-apply relocates
 * mail out of the inbox, which would disturb the shared onboarded account other
 * specs read.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, listServerSubjects } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };

const STAMP = Date.now();
const KEEP_SENDER = `keep-${STAMP}@example.com`;
const OTHER_SENDER = `other-${STAMP}@example.com`;
const FOLDER_NAME = `E2E BackApply ${STAMP}`;
const RULE_NAME = `E2E BackApply rule ${STAMP}`;

const KEEP_SUBJECTS = [1, 2, 3].map((n) => `E2E Keep ${STAMP} #${n}`);
const OTHER_SUBJECTS = [1, 2].map((n) => `E2E Stay ${STAMP} #${n}`);

test.describe("Standing filter back-applies over existing mail", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Standing Back-Apply");
		api = new ApiClient(run.token);
	});

	test("creating a standing rule with a new folder moves the mail already in the inbox", async ({
		browser,
	}) => {
		test.setTimeout(600_000);

		// Two senders into one inbox: three from the sender the rule will match, two
		// from another that must stay put.
		await appendMessages(
			run.imapUser,
			KEEP_SUBJECTS.map((subject) => ({
				subject,
				from: `Keep Sender <${KEEP_SENDER}>`,
			})),
		);
		await appendMessages(
			run.imapUser,
			OTHER_SUBJECTS.map((subject) => ({
				subject,
				from: `Other Sender <${OTHER_SENDER}>`,
			})),
		);

		const total = KEEP_SUBJECTS.length + OTHER_SUBJECTS.length;
		await waitFor(
			async () => {
				await api.triggerSync(run.accountId).catch(() => undefined);
				return api.listMailboxes(run.accountId);
			},
			(boxes) =>
				(boxes.find((b) => b.mailboxId === run.inboxId)?.messageCount ?? 0) >=
				total,
			{
				timeoutMs: 300_000,
				intervalMs: 4_000,
				what: "the seed to reach the inbox",
			},
		);

		const context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
		const page = await context.newPage();

		try {
			await page.goto(`/mail/${run.inboxId}`);
			const rows = page.locator("[data-message-row]");
			await expect(rows.first()).toBeVisible({ timeout: 30_000 });

			const keepRow = (subject: string) => rows.filter({ hasText: subject });
			await expect(keepRow(KEEP_SUBJECTS[0])).toBeVisible({ timeout: 30_000 });

			// Enter selection on two messages from the same sender: the fallback
			// derives a single `From` clause from them.
			await keepRow(KEEP_SUBJECTS[0]).click({ modifiers: ["ControlOrMeta"] });
			await keepRow(KEEP_SUBJECTS[1]).click({ modifiers: ["ControlOrMeta"] });

			await page
				.getByRole("button", { name: "Organize similar messages" })
				.click();

			// The widen probe resolves (semantic-absent) and the editor opens on the
			// sender fallback.
			const destination = page.getByRole("combobox", {
				name: "Destination folder",
			});
			await expect(destination).toBeVisible({ timeout: 30_000 });

			// Create the move destination from inside the editor.
			await destination.selectOption({ label: "＋ New folder…" });
			const newFolderField = page.getByRole("textbox", {
				name: "New folder name",
			});
			await expect(newFolderField).toBeVisible({ timeout: 10_000 });
			await newFolderField.fill(FOLDER_NAME);
			await page.getByRole("button", { name: "Create folder" }).click();

			const created = await waitFor(
				() => api.listMailboxes(run.accountId),
				(boxes) => boxes.some((b) => b.fullPath === FOLDER_NAME),
				{
					timeoutMs: 60_000,
					what: `the folder "${FOLDER_NAME}" to be created`,
				},
			);
			const folder = created.find((b) => b.fullPath === FOLDER_NAME);
			if (!folder) throw new Error("unreachable: folder matched but not found");
			await expect(destination).toHaveValue(folder.mailboxId, {
				timeout: 15_000,
			});

			// Keep doing this — a standing rule, named.
			await page.getByText("Keep doing this", { exact: true }).click();
			await page.getByLabel("Rule name").fill(RULE_NAME);

			const save = page.getByRole("button", { name: "Save rule" });
			await expect(save).toBeEnabled({ timeout: 60_000 });
			await save.click();

			// The back-apply runs and reports its summary — not a bare saved screen.
			await expect(page.getByText(/moved/)).toBeVisible({ timeout: 120_000 });
		} finally {
			await context.close();
		}

		// Server truth: the fresh folder holds every matched message, and the inbox
		// holds only the two that never matched. Read straight off Dovecot, after
		// the exclusive move reconciles to the server.
		await waitFor(
			() => listServerSubjects(run.imapUser, FOLDER_NAME),
			(subjects) =>
				KEEP_SUBJECTS.every((subject) => subjects.includes(subject)),
			{
				timeoutMs: 300_000,
				intervalMs: 4_000,
				what: "every matched message to land in the new folder on the server",
			},
		);

		await waitFor(
			() => listServerSubjects(run.imapUser, "INBOX"),
			(subjects) =>
				KEEP_SUBJECTS.every((subject) => !subjects.includes(subject)) &&
				OTHER_SUBJECTS.every((subject) => subjects.includes(subject)),
			{
				timeoutMs: 300_000,
				intervalMs: 4_000,
				what: "the matched mail to leave the inbox and the rest to stay",
			},
		);
	});
});
