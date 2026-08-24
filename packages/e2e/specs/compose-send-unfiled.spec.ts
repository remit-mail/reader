/**
 * Issue #824: a message the recipient received and the sender could reach in no
 * view. Filing the copy in Sent is the last hop of a send, and an account with
 * no Sent folder has nowhere to put it — so the outbox row settles at `unfiled`
 * and stays listed, saying what happened, instead of being deleted the way a
 * filed send's row is.
 *
 * The account's Sent folder is removed through the app, which is the whole of
 * what the worker resolves. Dovecot re-materialises its own `Sent` on the next
 * login — the e2e fixture declares it `auto = subscribe` — so the folder that
 * went missing is the account's, and the server still has one for this spec to
 * read back and find empty.
 *
 * The other way to make the APPEND impossible is to appoint a folder and delete
 * it off the server: what that produces is an APPEND the server refuses, which
 * is retried to the redrive budget a visibility timeout apart, and the watch
 * above the composer gives up after a minute. The row would settle long after
 * the client stopped looking and the client's half of this — the settle, the
 * reason on screen — could not be asserted at all. Nothing here is refused; the
 * account simply has no folder, which is what #824 delivered mail into.
 *
 * The removal only holds while nothing re-derives the folder list, because
 * Dovecot has a `Sent` folder again the moment anything logs in and a sync
 * would take it back into the account. Booting the app is one of those: reading
 * `/config` triggers a mailbox sync for every account the user has. So the app
 * is loaded first and its boot sync watched all the way in — a folder made
 * behind its back is what that is read off — and the folder is taken away after
 * it. Nothing else syncs inside the window that follows: the scheduler takes
 * accounts a quarter of an hour past their last sync, and the client's own poll
 * is minutes out. A sync that did land would file the copy and drop the row,
 * which fails this spec rather than quietly passing it.
 *
 * Its own throwaway user, which is also what makes the folder expendable.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, type Mailbox, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	createServerMailbox,
	listServerMailboxes,
	listServerSubjects,
} from "../src/imap.js";
import { expectNoFatalOverlay } from "../src/overlay.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	countAcceptedMessages,
	waitForAcceptedMessage,
} from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

/** One outbox message by id: the row the watch above the composer reads. */
const OUTBOX_DETAIL = /\/api\/outbox\/[^/?]+(?:\?|$)/;

const SEND_REQUEST = /\/api\/outbox\/([^/?]+)\/send(?:\?|$)/;

/** Three poll intervals, so a watch that had not stopped would have shown it. */
const QUIET_WINDOW_MS = 6_000;

const SENT_FOLDER = "Sent";

const BODY = "Delivered to a recipient, and filed in no folder of mine.";

/**
 * Every leaf name the Sent role is resolved by when nobody appointed a folder
 * (`ROLE_NAME_HINTS` in data-ports/folder-role.ts). The spec is about an account
 * with no Sent folder, and a folder named like one is a Sent folder as far as
 * the worker is concerned.
 */
const SENT_LEAF_NAMES = new Set([
	"sent",
	"sent items",
	"sent messages",
	"sent mail",
]);

const couldHoldTheSentRole = (mailbox: Mailbox): boolean =>
	(mailbox.specialUse ?? []).some(
		(designation) => designation.toLowerCase() === "\\sent",
	) ||
	SENT_LEAF_NAMES.has(
		(mailbox.fullPath.split("/").pop() ?? "").toLowerCase().trim(),
	);

/**
 * A folder's row is dropped by the worker that confirms the IMAP delete, and
 * the account's mailbox list stops reporting it the moment the delete is
 * accepted — so the list cannot say whether the row is gone. Role resolution
 * reads the row, so this asks for the row.
 */
const mailboxRowStatus = async (
	api: ApiClient,
	accountId: string,
	mailboxId: string,
): Promise<number> => {
	const response = await api.request(
		"GET",
		`/accounts/${accountId}/mailboxes/${mailboxId}`,
	);
	await response.text();
	return response.status;
};

test.describe("A send with no Sent folder to file into (#824)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Send Unfiled");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("the message goes out and its row stays, saying it was not filed", async () => {
		test.setTimeout(300_000);

		const stamp = Date.now();
		const subject = `Sent but unfiled ${stamp}`;
		const syncMarker = `INBOX/Sync marker ${stamp}`;

		// Made behind the app's back, so its arrival in the account is the boot's
		// folder sync finishing — the one that would put a deleted Sent back.
		await createServerMailbox(run.imapUser, syncMarker);

		const page = await context.newPage();

		const polls: number[] = [];
		let sentOutboxMessageId: string | undefined;
		let watchReadUnfiledAt: number | undefined;

		page.on("request", (request) => {
			const send = SEND_REQUEST.exec(request.url());
			if (request.method() === "POST" && send) sentOutboxMessageId = send[1];
			if (request.method() === "GET" && OUTBOX_DETAIL.test(request.url())) {
				polls.push(Date.now());
			}
		});
		page.on("response", async (response) => {
			if (response.request().method() !== "GET") return;
			if (!OUTBOX_DETAIL.test(response.url()) || response.status() !== 200) {
				return;
			}
			const row = await response
				.json()
				.then((body: { status?: string }) => body)
				.catch(() => ({ status: undefined }));
			if (row.status === "unfiled") watchReadUnfiledAt ??= Date.now();
		});

		await page.goto("/mail");
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(list) => list.some((box) => box.fullPath === syncMarker),
			{
				timeoutMs: 120_000,
				what: "the folder list the app re-derives when it boots",
			},
		);

		const mailboxes = await api.listMailboxes(run.accountId);
		const sent = mailboxes.find((box) => box.fullPath === SENT_FOLDER);
		if (!sent) throw new Error(`the account has no ${SENT_FOLDER} folder`);

		const deleted = await api.deleteMailbox(run.accountId, sent.mailboxId);
		expect(deleted.status).toBe(204);
		await waitFor(
			() => mailboxRowStatus(api, run.accountId, sent.mailboxId),
			(status) => status === 404,
			{ timeoutMs: 90_000, what: "the Sent folder to leave the account" },
		);

		// The role falls back to the server's flag and then to a conventional
		// name, so "no Sent folder" is a claim about every folder the account has.
		const left = await api.listMailboxes(run.accountId);
		expect(left.filter(couldHoldTheSentRole)).toEqual([]);

		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);
		await body.click();
		await page.keyboard.type(BODY);

		await page.getByRole("button", { name: "Send", exact: true }).click();

		// Compose closing is the app saying the send was accepted, and is what
		// leaves the watch running with nothing on screen to own its answers.
		await expect(body).toBeHidden({ timeout: 30_000 });

		await expect
			.poll(() => sentOutboxMessageId, { timeout: 30_000 })
			.toBeDefined();
		const outboxMessageId = sentOutboxMessageId;
		if (!outboxMessageId) {
			throw new Error("unreachable: the send was matched but not captured");
		}

		// The recipient's half: the message left the process. Counted under this
		// run's own subject, because the sink is shared and never emptied.
		await waitForAcceptedMessage(subject);
		expect(await countAcceptedMessages(subject)).toBe(1);

		// `sent` is a status the row holds for well under a second on its way
		// through; `unfiled` is where the filing stops, and it is what the user is
		// left with.
		const settled = await waitFor(
			() => api.getOutboxMessage(outboxMessageId),
			(row) => row.status === "unfiled",
			{
				timeoutMs: 180_000,
				what: "the outbox row to settle as sent but unfiled",
			},
		);
		expect(settled.lastError ?? "").toContain("Sent, but not filed");

		await expect
			.poll(() => watchReadUnfiledAt !== undefined, {
				timeout: 60_000,
				message: "the send watch to read the unfiled outbox row",
			})
			.toBe(true);
		const polledWhenSettled = polls.length;

		// A settled row is an answer, not a failure: the watch stops on it and the
		// app stays standing (#921).
		await expectNoFatalOverlay(page, QUIET_WINDOW_MS);
		expect(polls.length).toBe(polledWhenSettled);

		// Read off Dovecot behind the settled row, which is where the filing
		// stopped: no copy in the folder the server keeps making, and none
		// anywhere else either.
		expect(await listServerSubjects(run.imapUser, SENT_FOLDER)).not.toContain(
			subject,
		);
		const everythingOnTheServer: string[] = [];
		for (const path of await listServerMailboxes(run.imapUser)) {
			everythingOnTheServer.push(
				...(await listServerSubjects(run.imapUser, path)),
			);
		}
		expect(everythingOnTheServer).not.toContain(subject);

		// The outbox row is the only copy of a delivered message, so it is listed,
		// and it says which folder is missing and how to give the account one.
		await page.goto("/mail/outbox");
		const row = page.locator("[data-list-row]").filter({ hasText: subject });
		await expect(row).toBeVisible({ timeout: 30_000 });
		await expect(row).toContainText("Sent, not filed");
		await expect(row).toContainText("no folder appointed to the Sent role");
		await expectNoFatalOverlay(page);
	});
});
