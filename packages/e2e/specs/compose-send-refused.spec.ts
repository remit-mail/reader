/**
 * Issue #925, spec 3: a send the outgoing server refuses.
 *
 * Every send spec on main submits to a server that accepts whatever it is
 * handed, so the refusal half of the path has never run: the outbox row that
 * settles `failed`, the sentence it settles with, and the retry that is supposed
 * to get it out again. Two defect classes live in that gap — a failure the app
 * knows about and never says (D), and a row the user can see but can no longer
 * do anything with (F).
 *
 * The account here submits to the lane that refuses, a second Mailpit whose
 * recipient allowlist names one address, so every other recipient is turned
 * away at RCPT TO with a 550 and the submission ends having delivered nothing.
 * That is the only thing different about this run: the lane is per account, and
 * every other account in the suite still uses the one that accepts.
 *
 * There are two recoveries, and the row supports both. One is the account's:
 * the outgoing server that refused it is corrected and the same row is sent
 * again from the Outbox. The other is the message's (#933): the recipient the
 * server refused is corrected in the composer and the same row is sent again —
 * which is the half that used to dead-end, because a `failed` row took a 409 on
 * the write the composer makes before every send.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import {
	baseUrl,
	rejectingSmtpFromStack,
	rejectingSmtpSinkApi,
	smtpFromStack,
} from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { waitForOutboxStatus, waitForSettledOutboxRow } from "../src/outbox.js";
import { expectNoFatalOverlay } from "../src/overlay.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	countAcceptedMessages,
	expectNothingAccepted,
	readAcceptedEnvelope,
	waitForAcceptedMessage,
} from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

const SEND_REQUEST = /\/api\/outbox\/([^/?]+)\/send(?:\?|$)/;

/**
 * The address the lane turns away. Nothing about it is malformed — the refusal
 * is the server's, which is what makes it a failure that only shows up on the
 * wire and never in front of the composer.
 */
const RECIPIENT = "ada@remit.test";

/**
 * The one address the lane's allowlist names, and so the only correction that
 * gets a message through it. Nothing about the refused address is malformed —
 * this is a server that accepts one recipient and refuses the rest, which is
 * what a wrong address looks like from the composer.
 */
const CORRECTED_RECIPIENT = "corrected@remit.test";

const BODY = "Refused at the door, and the user has to be told so.";

/** Three of the send watch's two-second polls, so a watch still running shows. */
const QUIET_WINDOW_MS = 6_000;

test.describe("A send the outgoing server refuses (#925)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Refused Send", [], {
			smtp: rejectingSmtpFromStack,
		});
		api = new ApiClient(run);

		// The successful retry ends with the row filed into Sent and deleted, and
		// that delete is what says the row recovered. Dovecot creates the folder on
		// first login, so this waits on the sync having seen it.
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);

		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("the refusal reaches the user, and the row still sends afterwards", async () => {
		test.setTimeout(300_000);

		const page = await context.newPage();
		const subject = `Refused send ${Date.now()}`;

		let outboxMessageId: string | undefined;
		page.on("request", (request) => {
			const send = SEND_REQUEST.exec(request.url());
			if (request.method() === "POST" && send) outboxMessageId = send[1];
		});

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill(RECIPIENT);
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);
		await body.click();
		await page.keyboard.type(BODY);

		await page.getByRole("button", { name: "Send", exact: true }).click();

		// Compose closing is the app accepting the send. Nothing has been refused
		// yet at this point — the submission happens on the queue behind it, which
		// is exactly why the outcome has to arrive somewhere the user can find it.
		await expect(body).toBeHidden({ timeout: 30_000 });

		await expect.poll(() => outboxMessageId, { timeout: 30_000 }).toBeDefined();
		if (!outboxMessageId) {
			throw new Error("unreachable: the send was matched but not captured");
		}

		const refused = await waitForSettledOutboxRow(
			api,
			outboxMessageId,
			"failed",
		);
		const reason = refused.lastError ?? "";
		expect(reason).not.toBe("");

		// The claim the refusal makes: nobody got this. Read after the row has
		// settled, so the submission is over rather than still in flight, and given
		// a window on top of that. Per subject and never over the sink's totals —
		// it is shared by the whole run and never emptied.
		await expectNothingAccepted(subject, QUIET_WINDOW_MS, {
			sinkApi: rejectingSmtpSinkApi,
		});
		// Nor did it quietly go out down the lane the account does not use.
		expect(await countAcceptedMessages(subject)).toBe(0);

		// A send that failed is not a broken app: the watch above the composer has
		// its answer and is done with it.
		await expectNoFatalOverlay(page);

		// What the user is left with, in the Outbox, in the app's own words.
		await page.goto("/mail/outbox");
		await expect(page.getByText(subject)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText("Failed", { exact: true })).toBeVisible();
		await expect(page.getByText(reason)).toBeVisible();

		// The row is still the user's to act on. This is the whole of defect class
		// F: a row that can be seen and not moved is a row that has to be deleted
		// and retyped.
		const retry = page.getByRole("button", { name: "Retry sending" });
		await expect(retry).toHaveCount(1);

		// What changes here is the account's outgoing server rather than the
		// message — the same PATCH the settings panel makes when someone corrects
		// it. Correcting the message instead is the other recovery, below.
		await api.updateAccount(run.accountId, {
			smtpHost: smtpFromStack.host,
			smtpPort: smtpFromStack.port,
		});

		await retry.click();

		// Sent, filed and dropped: the row the Outbox held is gone, which is the
		// same settled state a first-time send ends on.
		await waitForOutboxStatus(api, outboxMessageId, 404);

		await waitForAcceptedMessage(subject);
		expect(await countAcceptedMessages(subject)).toBe(1);

		await expectNoFatalOverlay(page, QUIET_WINDOW_MS);
	});
});

/**
 * Issue #933: the recovery that belongs to the message rather than the account.
 *
 * A send refused for its recipient is corrected by changing the recipient, and
 * that is the one thing the row would not accept: the composer flushes the
 * fields through PATCH before every send, a `failed` row answered 409, and the
 * send never went out. Delete and retype was the only way through.
 *
 * Its own isolated run, so the account here keeps submitting to the lane that
 * refuses — the spec above ends by correcting its account's outgoing server,
 * and a shared account would make this test's delivery that correction's.
 */
test.describe("Correcting the recipient of a refused message (#933)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Corrected Recipient", [], {
			smtp: rejectingSmtpFromStack,
		});
		api = new ApiClient(run);

		await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);

		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("the corrected message goes out, and goes out once", async () => {
		test.setTimeout(300_000);

		const page = await context.newPage();
		const subject = `Corrected recipient ${Date.now()}`;

		let outboxMessageId: string | undefined;
		page.on("request", (request) => {
			const send = SEND_REQUEST.exec(request.url());
			if (request.method() === "POST" && send) outboxMessageId = send[1];
		});

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill(RECIPIENT);
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);
		await body.click();
		await page.keyboard.type(BODY);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(body).toBeHidden({ timeout: 30_000 });

		await expect.poll(() => outboxMessageId, { timeout: 30_000 }).toBeDefined();
		if (!outboxMessageId) {
			throw new Error("unreachable: the send was matched but not captured");
		}

		await waitForSettledOutboxRow(api, outboxMessageId, "failed");

		// Back into the composer through the row's own control, because the 409
		// this pins was raised by what the composer does on the way out, not by
		// anything the user could see on the way in.
		await page.goto("/mail/outbox");
		await expect(page.getByText(subject)).toBeVisible({ timeout: 30_000 });
		await page.getByRole("button", { name: "Edit as draft" }).first().click();

		const reopened = page.getByTestId("compose-body");
		await expect(reopened).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("button", { name: `Remove ${RECIPIENT}` }),
		).toBeVisible({ timeout: 30_000 });

		await page.getByRole("button", { name: `Remove ${RECIPIENT}` }).click();
		await page.getByPlaceholder("Recipients").fill(CORRECTED_RECIPIENT);
		await page.getByPlaceholder("Recipients").press("Enter");

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(reopened).toBeHidden({ timeout: 30_000 });

		// Sent, filed and dropped — the same settled state a first-time send ends
		// on, reached by the row the Outbox was holding at `failed`.
		await waitForOutboxStatus(api, outboxMessageId, 404);

		// Server truth: the lane that refused the first submission accepted this
		// one, and accepted it addressed to the corrected recipient.
		const accepted = await waitForAcceptedMessage(subject, {
			sinkApi: rejectingSmtpSinkApi,
		});
		const envelope = await readAcceptedEnvelope(accepted.id, {
			sinkApi: rejectingSmtpSinkApi,
		});
		expect(envelope.to).toEqual([CORRECTED_RECIPIENT]);

		// Once. The refused submission delivered nothing and the correction is one
		// message, not a second copy of the first.
		expect(
			await countAcceptedMessages(subject, { sinkApi: rejectingSmtpSinkApi }),
		).toBe(1);

		await expectNoFatalOverlay(page, QUIET_WINDOW_MS);
	});
});
