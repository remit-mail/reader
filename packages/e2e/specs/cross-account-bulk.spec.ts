/**
 * Delete and Mark read over a brief selection that spans two accounts, read
 * back off the mail servers (#884).
 *
 * The bulk endpoints refuse a batch spanning accounts before applying any of
 * it, so #880 split a cross-account selection into one call per account. What
 * a render test can show is the requests the client believed it made; whether
 * the second account's mail actually moved is a question only Dovecot answers,
 * and a UI that reports "Deleted 3" is exactly as convincing when nothing left
 * the second mailbox.
 *
 * What catches a regression to one batch is the per-account pair: each
 * account's subjects have to have left that account's own INBOX and arrived in
 * that account's own Trash. A batch spanning accounts is refused whole before
 * any of it is applied (`assertMessagesOwned` in
 * `packages/backend/src/handlers/message.ts`), so a client that sent one call
 * fails the run outright — the run screen never says it deleted them, and the
 * waits on the second server never settle.
 *
 * The two cross-Trash reads at the end are insurance, not the proof: they cover
 * a filing the endpoint would have to have done while refusing to do it, which
 * nothing can currently produce.
 *
 * Every wait is on the mail server. A delete is answered off the read model and
 * the IMAP move is queued behind that answer, so a read taken when the run
 * screen settles is a read of the projection. This spec asserts settled server
 * state, which is the wait side of `docs/architecture/imap-mutations.md` R2.
 *
 * Two accounts on one throwaway user, never the shared fixture: a second
 * account there would change the sidebar and the per-account counts the rest of
 * the suite reads, and nothing here may depend on a global message count.
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	listServerSubjects,
	serverFlagsForSubject,
	waitForServerMailbox,
} from "../src/imap.js";
import {
	connectIsolatedAccount,
	type IsolatedAccount,
	type IsolatedRun,
	provisionIsolatedRun,
} from "../src/provision.js";
import {
	advanceTo,
	barDelete,
	commitButton,
	dismissRun,
	wizardStep,
} from "../src/wizard.js";

/** Single-pane (< 1024px) and wide enough (≥ 640px) that each row lays out its
 *  own selection toggle, so selection is entered with a tap rather than a long
 *  press — the width `brief-selection.spec.ts` drives the brief at. */
const TABLET = { width: 800, height: 1106 };

/** Dovecot gives every maildir a `\Trash`-flagged `Trash`, at the root. */
const TRASH = "Trash";

const STAMP = Date.now();

const FIRST_DELETED = [
	`Cross account delete first alpha ${STAMP}`,
	`Cross account delete first beta ${STAMP}`,
];
const SECOND_DELETED = [`Cross account delete second ${STAMP}`];
const FIRST_READ = [`Cross account read first ${STAMP}`];
const SECOND_READ = [`Cross account read second ${STAMP}`];

const row = (page: Page, subject: string): Locator =>
	page.locator("[data-message-row]").filter({ hasText: subject });

/** The row's leading selection toggle (`ui/message-row.tsx`). The first tap
 *  enters selection mode; every later one ticks another row. */
const rowToggle = (target: Locator): Locator =>
	target.getByRole("button", { name: /^(Select|Deselect) message$/ });

/** The bar's count line, by its own hook: the bar also holds the search field,
 *  whose live region would otherwise answer to `role="status"` first. */
const selectionStatus = (page: Page): Locator =>
	page.locator("[data-selection-count]");

/** Mark read is an overflow verb, reached through the bar's kebab. */
const barMarkRead = async (page: Page): Promise<void> => {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Mark read" }).click();
};

const openBrief = async (
	context: BrowserContext,
	subjects: string[],
): Promise<Page> => {
	const page = await context.newPage();
	await page.goto("/mail");
	// The brief is fed by a sync that is still running when the page opens, so
	// the rows are waited for across reloads rather than in one render.
	await expect(async () => {
		await page.reload();
		for (const subject of subjects) {
			await expect(row(page, subject)).toBeVisible({ timeout: 5_000 });
		}
	}).toPass({ timeout: 120_000 });
	return page;
};

const selectRows = async (page: Page, subjects: string[]): Promise<void> => {
	for (const subject of subjects) {
		const target = row(page, subject);
		await rowToggle(target).click();
		await expect(rowToggle(target)).toHaveAccessibleName("Deselect message");
	}
	// The bar words a selection covering every loaded row differently from a
	// partial one — "All 2 loaded selected" against "2 messages selected" — and
	// which it is depends on what else the brief happens to hold. The rows above
	// are what carries the claim; this only checks the bar counted them all.
	await expect(selectionStatus(page)).toHaveText(
		new RegExp(`\\b${subjects.length}\\b`),
	);
};

/**
 * The run screen's headline once the run has ended: the verb in the past tense
 * and the number it reached. Anchored, so a run that reached ten of them cannot
 * satisfy an assertion about one.
 */
const expectRunOutcome = (page: Page, outcome: string): Promise<void> =>
	expect(page.getByText(new RegExp(`^${outcome}$`))).toBeVisible({
		timeout: 60_000,
	});

const expectLeftInbox = (account: IsolatedAccount, subjects: string[]) =>
	waitForServerMailbox(
		account.imapUser,
		"INBOX",
		(held) => subjects.every((subject) => !held.includes(subject)),
		{ what: `${subjects.join(", ")} to leave the inbox` },
	);

const expectInTrash = (account: IsolatedAccount, subjects: string[]) =>
	waitForServerMailbox(
		account.imapUser,
		TRASH,
		(held) => subjects.every((subject) => held.includes(subject)),
		{ what: `${subjects.join(", ")} to reach Trash` },
	);

const expectSeen = (account: IsolatedAccount, subject: string) =>
	waitFor(
		() => serverFlagsForSubject(account.imapUser, "INBOX", subject),
		(flags) => flags.includes("\\Seen"),
		{ timeoutMs: 60_000, what: `\\Seen to be set on "${subject}"` },
	);

/**
 * The flag is unset, on a message that is there. An absent subject has no flags
 * either, so the presence read is what stops the pre-assertion passing on a
 * mailbox the fixture never reached.
 */
const expectUnseen = async (
	account: IsolatedAccount,
	subject: string,
): Promise<void> => {
	const held = await listServerSubjects(account.imapUser, "INBOX");
	expect(held).toContain(subject);
	const flags = await serverFlagsForSubject(account.imapUser, "INBOX", subject);
	expect(flags).not.toContain("\\Seen");
};

test.describe("A brief selection spanning two accounts", () => {
	let run: IsolatedRun;
	let second: IsolatedAccount;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(600_000);
		run = await provisionIsolatedRun("E2E Cross Account First", [
			...FIRST_DELETED.map((subject) => ({ subject })),
			...FIRST_READ.map((subject) => ({ subject })),
		]);
		api = new ApiClient(run);
		second = await connectIsolatedAccount(api, "E2E Cross Account Second", [
			...SECOND_DELETED.map((subject) => ({ subject })),
			...SECOND_READ.map((subject) => ({ subject })),
		]);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: TABLET,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("Delete moves every account's own messages into its own Trash", async () => {
		test.setTimeout(600_000);
		const selected = [...FIRST_DELETED, ...SECOND_DELETED];
		const page = await openBrief(context, selected);

		await selectRows(page, selected);
		await barDelete(page).click();
		await expect(wizardStep(page)).toHaveText(/ · Apply to$/, {
			timeout: 20_000,
		});
		await advanceTo(page, "Review");
		await commitButton(page, "Delete").click();
		await expectRunOutcome(page, `Deleted ${selected.length}`);
		await dismissRun(page);

		await expectLeftInbox(run, FIRST_DELETED);
		await expectLeftInbox(second, SECOND_DELETED);
		await expectInTrash(run, FIRST_DELETED);
		await expectInTrash(second, SECOND_DELETED);

		// Neither account's mail was filed under the other's Trash. Both waits
		// above have already settled, so these are reads of a finished state.
		const firstTrash = await listServerSubjects(run.imapUser, TRASH);
		for (const subject of SECOND_DELETED) {
			expect(firstTrash).not.toContain(subject);
		}
		const secondTrash = await listServerSubjects(second.imapUser, TRASH);
		for (const subject of FIRST_DELETED) {
			expect(secondTrash).not.toContain(subject);
		}
	});

	test("Mark read sets \\Seen on every account's own messages", async () => {
		test.setTimeout(600_000);
		const selected = [...FIRST_READ, ...SECOND_READ];
		const page = await openBrief(context, selected);

		// Neither server holds the flag before the verb runs, so the assertions
		// after it cannot be satisfied by mail that arrived already seen.
		for (const subject of FIRST_READ) await expectUnseen(run, subject);
		for (const subject of SECOND_READ) await expectUnseen(second, subject);

		await selectRows(page, selected);
		await barMarkRead(page);
		await expect(wizardStep(page)).toHaveText(/ · Apply to$/, {
			timeout: 20_000,
		});
		await advanceTo(page, "Review");
		await commitButton(page, "Mark read").click();
		await expectRunOutcome(page, `Marked read ${selected.length}`);
		await dismissRun(page);

		for (const subject of FIRST_READ) await expectSeen(run, subject);
		for (const subject of SECOND_READ) await expectSeen(second, subject);
	});
});
