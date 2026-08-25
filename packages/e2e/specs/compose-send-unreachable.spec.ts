/**
 * Issue #951: a send that never reaches the outgoing server at all.
 *
 * The refused send (`compose-send-refused.spec.ts`) gets as far as a
 * conversation with a server and is turned away inside it. This one does not:
 * the account submits to a port nothing listens on, so nodemailer throws
 * before a session exists and the handler never sees a `SendResult` to settle
 * from. That threw straight past the row, which stayed at `sending` until the
 * record dead-lettered — a spinner with no Retry, no Delete and no reason,
 * and the exact shape the stale-SMTP-password case takes on a self-hosted
 * instance.
 *
 * What the settle has to produce is what this asserts: a row at `failed`
 * carrying the reason the connection gave, the Retry button that status is
 * what unlocks, and a send that actually goes out once the account is
 * corrected. The stack's `SEND_MESSAGE_MAX_ATTEMPTS` is 1 (`e2e.env`), so the
 * first delivery is also the exhausted one.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl, smtpFromStack } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { waitForOutboxStatus, waitForSettledOutboxRow } from "../src/outbox.js";
import { expectNoFatalOverlay } from "../src/overlay.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	countAcceptedMessages,
	expectNothingAccepted,
	waitForAcceptedMessage,
} from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

const SEND_REQUEST = /\/api\/outbox\/([^/?]+)\/send(?:\?|$)/;

/**
 * Where this account submits: the sink's own host on a port nothing listens
 * on, so the connection is refused before a session opens. Nothing is deployed
 * for it — a refused connection needs no server, which is what keeps this off
 * the stack entirely.
 */
const UNREACHABLE_SMTP = { host: smtpFromStack.host, port: 1 };

const RECIPIENT = "ada@remit.test";

const BODY = "The server was never there, and the user has to be told so.";

/** Three of the send watch's two-second polls, so a watch still running shows. */
const QUIET_WINDOW_MS = 6_000;

test.describe("A send that never reaches the outgoing server (#951)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Unreachable Send", [], {
			smtp: UNREACHABLE_SMTP,
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

	test("the row settles failed with the reason, and still sends afterwards", async () => {
		test.setTimeout(300_000);

		const page = await context.newPage();
		const subject = `Unreachable send ${Date.now()}`;

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

		// Before #951 this poll ran out with the row still at `sending`.
		const settled = await waitForSettledOutboxRow(
			api,
			outboxMessageId,
			"failed",
		);
		const reason = settled.lastError ?? "";
		expect(reason).not.toBe("");

		// Nothing left the process: there was no server to take it.
		await expectNothingAccepted(subject, QUIET_WINDOW_MS);

		await expectNoFatalOverlay(page);

		await page.goto("/mail/outbox");
		await expect(page.getByText(subject)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText("Failed", { exact: true })).toBeVisible();
		await expect(page.getByText(reason)).toBeVisible();

		// The status is what unlocks this control, so its presence is the settle
		// having landed somewhere the user can act on rather than in a log line.
		const retry = page.getByRole("button", { name: "Retry sending" });
		await expect(retry).toHaveCount(1);

		// A `failed` row cannot be edited as a draft, so what changes here is the
		// account's outgoing server — the same PATCH the settings panel makes.
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
