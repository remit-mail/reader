/**
 * Two presses of Send, one message (#925 spec 6).
 *
 * Send is deliberately never greyed out — a dead control leaves the user
 * guessing whether the app is broken or the message is — so the second press is
 * always dispatched and something behind it has to absorb it. Nothing on this
 * path had ever been driven twice: every send spec presses once, and the
 * guard that makes a second press harmless was only ever read in a unit test.
 *
 * The race is made deterministic rather than raced for. Left to timing, the
 * first request usually completes before a second click can be delivered, and
 * the spec would pass on the send having finished rather than on the second
 * press being absorbed. Holding the send POST parks the first request in flight
 * for as long as the spec wants, so the second click is guaranteed to land in
 * the window that matters.
 *
 * What is asserted is what left the process: one message accepted by the SMTP
 * sink and one copy filed in Sent. Both are read per subject, because the sink
 * is shared by the whole run and never emptied. The negative is bounded by a
 * barrier send — a second, ordinary message pushed through the same SMTP and
 * message-management queues and waited for on the mail server, so anything the
 * double press had wrongly enqueued ran before the counts were taken.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { drainWithBarrier } from "../src/barrier.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { serverUidsForSubject } from "../src/imap.js";
import { waitForOutboxStatus } from "../src/outbox.js";
import { expectNoFatalOverlay } from "../src/overlay.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { holdRoute } from "../src/routes.js";
import { countAcceptedMessages } from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

const RECIPIENT = "ada@remit.test";

const BODY = "Pressed once, and then pressed again before anything answered.";

/** The one write this spec holds; everything else on the compose path runs. */
const SEND_ROUTE = "**/api/outbox/*/send";

test.describe("Pressing Send twice (#925)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Send Double Press");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});

		// A row whose account has no Sent folder settles `unfiled` instead of
		// being deleted, and this spec reads both the copy and the row's absence.
		// Dovecot creates the folder on first login, so this waits on the sync
		// having seen it.
		await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("leaves one message on the wire and one copy in Sent", async () => {
		test.setTimeout(300_000);

		const page = await context.newPage();
		const stamp = Date.now();
		const subject = `Double press ${stamp}`;
		const barrierSubject = `Double press barrier ${stamp}`;

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill(RECIPIENT);
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);
		await body.click();
		await page.keyboard.type(BODY);

		// The id the row is watched by afterwards, taken while the entry is still
		// a draft — a send deletes it, and there is nothing to read it off then.
		await expect(page.getByText("Draft saved")).toBeVisible({
			timeout: 30_000,
		});
		const drafts = await waitFor(
			() => api.listRemovableOutboxMessages(),
			(items) => items.some((item) => item.subject === subject),
			{ timeoutMs: 30_000, what: "the draft to autosave" },
		);
		const draft = drafts.find((item) => item.subject === subject);
		if (!draft) throw new Error("unreachable: the draft was matched but lost");

		let release = (): void => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await holdRoute(page, SEND_ROUTE, { until: held, methods: ["POST"] });

		const send = page.getByTestId("compose-send");
		await expect(send).toBeVisible();

		// The first press parks in the held route. The second is delivered to a
		// composer that has a send in flight and a Send button that still takes
		// clicks, which is the state a user produces by pressing twice.
		await send.click();
		await send.click();
		release();

		// Compose closing is the app saying the send was accepted.
		await expect(body).toBeHidden({ timeout: 30_000 });

		// The row is deleted after the copy is filed, so a 404 is the send
		// settled. Never the `sent` status: it lives under a second against a
		// two-second poll and is not there to be read.
		await waitForOutboxStatus(api, draft.outboxMessageId, 404);

		// A duplicate would ride the same two queues this barrier rides, so once
		// the barrier is on the mail server, what the counts below read is final.
		await drainWithBarrier(
			async () => {
				await api.sendMessage({
					accountId: run.accountId,
					toAddresses: [RECIPIENT],
					subject: barrierSubject,
					textBody: "Barrier.",
				});
			},
			{ imapUser: run.imapUser, mailbox: "Sent", subject: barrierSubject },
		);

		expect(await countAcceptedMessages(subject)).toBe(1);
		expect(
			await serverUidsForSubject(run.imapUser, "Sent", subject),
		).toHaveLength(1);

		// The barrier's own wait is the quiet window: a poll left running by the
		// absorbed press had every second of it to raise the overlay (#921).
		await expectNoFatalOverlay(page);
	});
});
