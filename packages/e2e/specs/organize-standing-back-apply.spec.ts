/**
 * Creating a standing filter runs the retroactive back-apply — the behavior the
 * standing scope used to skip — and does so against a folder created from inside
 * the rule editor.
 *
 * The exact reported flow: a selection is organized into a rule, a fresh folder
 * is created from the rule editor's destination affordance, and the rule is saved
 * with "Keep doing this". Before this change a standing save landed straight on
 * "Filter saved" and touched nothing already in the mailbox; now it enters the
 * back-apply, the same job the one-time scope runs.
 *
 * What this lane proves, in server truth: the standing filter is created and
 * points at the newly-created folder (not a dangling row), the folder is
 * materialized on Dovecot, and the save enters the back-apply rather than the old
 * immediate "Filter saved". The destination binds only after the folder reports
 * `syncStatus: synced` — the editor waits for the mail server to confirm the
 * folder before the filter can be committed against it, so the dependent write
 * never binds to a pending row. What it does not run to completion is the move: the
 * back-apply job is processed by the account-worker, which the source-built
 * e2e-dev stack does not start (only backend, imap-worker and web), so the job
 * stays queued here. The move/apply logic and the folder-identity fix are covered
 * by the mailbox-service and web-client unit suites; the mobile organize spec
 * drives the job's progress-to-summary states over a stubbed job.
 *
 * Runs as its own throwaway user (src/provision.ts): the flow files a filter and
 * a folder that would otherwise disturb the shared onboarded account.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { appendMessages, listServerMailboxes } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };

const STAMP = Date.now();
const SENDER = `keep-${STAMP}@example.com`;
const FOLDER_NAME = `E2E BackApply ${STAMP}`;
const RULE_NAME = `E2E BackApply rule ${STAMP}`;

const SUBJECTS = [1, 2, 3].map((n) => `E2E Keep ${STAMP} #${n}`);

test.describe("Standing filter back-applies over existing mail", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Standing Back-Apply");
		api = new ApiClient(run);
	});

	test("creating a standing rule with a new folder enters the back-apply and points the filter at the folder", async ({
		browser,
	}) => {
		test.setTimeout(600_000);

		await appendMessages(
			run.imapUser,
			SUBJECTS.map((subject) => ({
				subject,
				from: `Keep Sender <${SENDER}>`,
			})),
		);

		await waitFor(
			async () => {
				await api.triggerSync(run.accountId).catch(() => undefined);
				return api.listMailboxes(run.accountId);
			},
			(boxes) =>
				(boxes.find((b) => b.mailboxId === run.inboxId)?.messageCount ?? 0) >=
				SUBJECTS.length,
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

			const row = (subject: string) => rows.filter({ hasText: subject });
			await expect(row(SUBJECTS[0])).toBeVisible({ timeout: 30_000 });

			// Enter selection on two messages, then organize them into a rule.
			await row(SUBJECTS[0]).click({ modifiers: ["ControlOrMeta"] });
			await row(SUBJECTS[1]).click({ modifiers: ["ControlOrMeta"] });

			await page
				.getByRole("button", { name: "Organize selected messages" })
				.click();

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

			// The destination is a dependent write: the editor holds "Creating
			// folder…" and binds the destination only once the folder is confirmed
			// on the server, so the filter saved next cannot point at a pending row.
			await expect(destination).toHaveValue(folder.mailboxId, {
				timeout: 60_000,
			});
			const atBind = await api.listMailboxes(run.accountId);
			expect(
				atBind.find((b) => b.mailboxId === folder.mailboxId)?.syncStatus,
			).toBe("synced");

			// Keep doing this — a standing rule, named.
			await page.getByText("Keep doing this", { exact: true }).click();
			await page.getByLabel("Rule name").fill(RULE_NAME);

			const save = page.getByRole("button", { name: "Save rule" });
			await expect(save).toBeEnabled({ timeout: 60_000 });
			await save.click();

			// The save enters the back-apply — the state the standing scope used to
			// skip — rather than landing straight on a bare "Filter saved".
			await expect(page.getByText(/Organizing/i)).toBeVisible({
				timeout: 60_000,
			});

			// The standing filter was created and points at the newly-created folder,
			// not the inbox and not a dangling row.
			const filters = await waitFor(
				() => api.listFilters(run.accountId),
				(list) => list.some((f) => f.name === RULE_NAME),
				{ timeoutMs: 30_000, what: "the standing filter to be created" },
			);
			const saved = filters.find((f) => f.name === RULE_NAME);
			expect(saved?.scope).toBe("Standing");
			expect(saved?.actionMailboxId).toBe(folder.mailboxId);
			expect(saved?.actionMailboxId).not.toBe(run.inboxId);
		} finally {
			await context.close();
		}

		// Server truth: the folder the editor created really exists on Dovecot, so
		// the rule's destination is a real synced folder.
		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => paths.includes(FOLDER_NAME),
			{
				timeoutMs: 60_000,
				what: `the folder "${FOLDER_NAME}" to exist on the IMAP server`,
			},
		);
	});
});
