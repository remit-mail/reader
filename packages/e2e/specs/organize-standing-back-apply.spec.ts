/**
 * Creating a standing filter runs the retroactive back-apply, against a folder
 * created from inside the wizard's Move step.
 *
 * The exact reported flow: a selection is organized into a rule, a fresh folder
 * is created on the folder step, and the rule is saved with "Keep doing this".
 * A standing save enters the back-apply, the same job the one-time scope runs,
 * rather than landing straight on "Filter saved".
 *
 * Creating a folder is an IMAP mutation and the move that follows is a
 * dependent write, and the decision is wait (docs/architecture/imap-mutations.md):
 * the step holds Continue until the mail server confirms the folder, so the
 * filter saved next cannot point at a pending row. That gate is asserted here
 * against the real server rather than a stub — it is the whole reason the step
 * waits.
 *
 * What this lane proves, in server truth: the standing filter is created and
 * points at the newly-created folder (not a dangling row), the folder is
 * materialized on Dovecot, and the back-apply the save entered actually moves
 * the mail — the selected messages leave the inbox and land in the new folder on
 * the mail server. That last leg crosses three processes: the account-worker
 * drains the job off the fan-out queue and applies it, and the move it commits
 * is pushed to Dovecot by the imap-worker off the message-management queue.
 *
 * The mobile organize spec drives the run screen's progress-to-summary states
 * over a stubbed job; the states are not re-asserted here.
 *
 * Runs as its own throwaway user (src/provision.ts): the flow files a filter and
 * a folder that would otherwise disturb the shared onboarded account.
 */
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	appendMessages,
	listServerMailboxes,
	waitForServerMailbox,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	advanceTo,
	barOrganize,
	commitButton,
	createFolderInPicker,
	expectBlockedReason,
	wizardContinue,
	wizardStep,
} from "../src/wizard.js";

const DESKTOP = { width: 1512, height: 864 };

const STAMP = Date.now();
const SENDER = `keep-${STAMP}@example.com`;
const FOLDER_NAME = `E2E BackApply ${STAMP}`;
const RULE_NAME = `E2E BackApply rule ${STAMP}`;

const SUBJECTS = [1, 2, 3].map((n) => `E2E Keep ${STAMP} #${n}`);

/**
 * The two rows the wizard is opened on. Whether the match door widens to the
 * sender or stays on the ticked rows, these two are in the applied set either
 * way — so they are what the back-apply is asserted over, and the folder is
 * never asserted to hold only them.
 */
const SELECTED = SUBJECTS.slice(0, 2);

/** The folder list the create's confirmation poll re-reads. */
const MAILBOX_LIST = /\/mailboxes(\?.*)?$/;

/** How many of those polls are held back, so the wait is observable. */
const STALLED_POLLS = 3;

test.describe("Standing filter back-applies over existing mail", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		run = await provisionIsolatedRun("E2E Standing Back-Apply");
		api = new ApiClient(run);
	});

	test("a folder created on the Move step holds Continue until the server confirms it, and the standing rule binds to it", async ({
		browser,
	}) => {
		test.setTimeout(900_000);

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
			await row(SELECTED[0]).click({ modifiers: ["ControlOrMeta"] });
			await row(SELECTED[1]).click({ modifiers: ["ControlOrMeta"] });

			await barOrganize(page).click();
			await expect(wizardStep(page)).toHaveText(/^Step 1 of 5 · Apply to$/, {
				timeout: 30_000,
			});

			await advanceTo(page, "Folder");

			// A real create, with the confirmation the step waits on held back, so
			// the wait is observable rather than a race against a fast server. The
			// folder is created for real; only the first few polls that confirm it
			// are slowed, and the handler stands down on its own — unrouting it
			// while a delayed poll is still in flight is what "Route is already
			// handled" means.
			let stalled = 0;
			await page.route(MAILBOX_LIST, async (route) => {
				if (route.request().method() !== "GET") return route.continue();
				if (stalled < STALLED_POLLS) {
					stalled += 1;
					await new Promise((resolve) => setTimeout(resolve, 2_000));
				}
				await route.continue();
			});

			await createFolderInPicker(page, FOLDER_NAME);

			// The wait is on screen, and Continue cannot leave the step while it
			// runs — the destination is a dependent write and the folder is not a
			// valid target until the mail server confirms it.
			await expect(
				page.getByText("Waiting for the mail server to confirm the folder…"),
			).toBeVisible({ timeout: 20_000 });
			await wizardContinue(page).click();
			await expectBlockedReason(page, "Pick a destination first.");
			await expect(wizardStep(page)).toHaveText(/· Folder$/);

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

			// The create resolved with the path the server normalized to, and only
			// then did the step take it as the destination.
			await expect(page.getByText(`Moving to ${FOLDER_NAME}.`)).toBeVisible({
				timeout: 60_000,
			});
			const atBind = await api.listMailboxes(run.accountId);
			expect(
				atBind.find((b) => b.mailboxId === folder.mailboxId)?.syncStatus,
			).toBe("synced");

			// Keep doing this — a standing rule, named.
			await advanceTo(page, "Rule");
			await page.getByText("Keep doing this", { exact: true }).click();
			await advanceTo(page, "Name");
			await page.getByLabel("Rule name").fill(RULE_NAME);
			await advanceTo(page, "Review");

			await commitButton(page, "Save rule").click();

			// The save enters the back-apply — the state the standing scope used to
			// skip — rather than landing straight on a bare "Filter saved".
			await expect(
				page.getByText(/Moving the mail already in your mailbox/),
			).toBeVisible({ timeout: 60_000 });

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

		// Server truth: the folder the wizard created really exists on Dovecot, so
		// the rule's destination is a real synced folder.
		await waitFor(
			() => listServerMailboxes(run.imapUser),
			(paths) => paths.includes(FOLDER_NAME),
			{
				timeoutMs: 60_000,
				what: `the folder "${FOLDER_NAME}" to exist on the IMAP server`,
			},
		);

		// Server truth: the back-apply ran to completion. The account-worker took
		// the job off the fan-out queue, matched the snapshotted predicate and
		// committed the moves; the imap-worker pushed them to Dovecot. The budget
		// covers both hops under CI load.
		await waitForServerMailbox(
			run.imapUser,
			FOLDER_NAME,
			(subjects) => SELECTED.every((subject) => subjects.includes(subject)),
			{
				timeoutMs: 180_000,
				what: `the back-apply to move ${SELECTED.length} messages into "${FOLDER_NAME}"`,
			},
		);

		// A move, not a copy: the same messages are gone from the inbox.
		await waitForServerMailbox(
			run.imapUser,
			"INBOX",
			(subjects) => SELECTED.every((subject) => !subjects.includes(subject)),
			{
				timeoutMs: 60_000,
				what: "the back-applied messages to leave the inbox",
			},
		);
	});
});
