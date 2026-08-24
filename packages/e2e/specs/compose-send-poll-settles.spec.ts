/**
 * Issue #921: a message that was sent, delivered and filed put the full-screen
 * fatal page over the app anyway, dozens of times.
 *
 * A send is confirmed by the outbox row disappearing — the worker APPENDs the
 * message to Sent and then drops the row — and the `sent` status it passes
 * through on the way lives for well under a second. The watch above the composer
 * polls every two, so what it reads is the row's absence. It read that 404 as a
 * failure: its stop condition only looked at a status it no longer had, so it
 * polled to the sixty-second cap and escalated every answer.
 *
 * The poll is held here until the API confirms the row is gone, which is the
 * race the user hits, made certain: what the watch gets back is a real 404 from
 * a real delete, and it is the first answer it sees. Both claims then stand
 * together — the watch settles and stops, and the send it settled on really did
 * leave the process and land in Sent.
 *
 * The watch is not the only reader of that row. The draft is a path segment, so
 * Back after a send reopens the composer on the id that was just deleted; the
 * second test is that address, and it has to close the surface rather than fail
 * on it.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { listServerSubjects } from "../src/imap.js";
import { waitForOutboxStatus } from "../src/outbox.js";
import { expectNoFatalOverlay } from "../src/overlay.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { holdRoute } from "../src/routes.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";
import { COMPOSE_URL } from "../src/urls.js";

const DESKTOP = { width: 1512, height: 864 };

/**
 * One outbox message, addressed by id. The list endpoint has no id segment and
 * the sub-resources all have one more, so neither is matched — and the id itself
 * is left unread, because what it is made of is the server's business.
 */
const OUTBOX_DETAIL = /\/api\/outbox\/[^/?]+(?:\?|$)/;

const SEND_REQUEST = /\/api\/outbox\/([^/?]+)\/send(?:\?|$)/;

/** Three poll intervals, so a watch that had not stopped would have shown it. */
const QUIET_WINDOW_MS = 6_000;

const BODY = "Filed and forgotten, which is the whole point.";

test.describe("A send settled by its outbox row disappearing (#921)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Send Poll Settles");
		api = new ApiClient(run);

		// With no Sent folder the worker skips the APPEND, and with it the delete
		// this spec is about. Dovecot creates one on first login, so this is a wait
		// on the sync having seen it, not on it existing.
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

	test("the watch stops on the deleted row and the app stays standing", async () => {
		test.setTimeout(240_000);

		const page = await context.newPage();
		const subject = `Poll settles ${Date.now()}`;

		const polls: number[] = [];
		let sentOutboxMessageId: string | undefined;
		let rowGoneAt: number | undefined;

		page.on("request", (request) => {
			const send = SEND_REQUEST.exec(request.url());
			if (request.method() === "POST" && send) sentOutboxMessageId = send[1];
			if (request.method() === "GET" && OUTBOX_DETAIL.test(request.url())) {
				polls.push(Date.now());
			}
		});
		page.on("response", (response) => {
			if (
				response.status() === 404 &&
				response.request().method() === "GET" &&
				OUTBOX_DETAIL.test(response.url())
			) {
				rowGoneAt ??= Date.now();
			}
		});

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);
		await body.click();
		await page.keyboard.type(BODY);

		let openTheGate: (() => void) | undefined;
		const rowIsGone = new Promise<void>((resolve) => {
			openTheGate = resolve;
		});
		// Registered here and not earlier: composing a fresh message reads no outbox
		// entry, and holding one that predates the send would gate the wrong request.
		await holdRoute(page, OUTBOX_DETAIL, { until: rowIsGone });

		await page.getByRole("button", { name: "Send", exact: true }).click();

		// Compose closing is the app saying the send was accepted, and is what leaves
		// the watch running above it with nothing on screen to own its failures.
		await expect(body).toBeHidden({ timeout: 30_000 });

		await expect
			.poll(() => sentOutboxMessageId, { timeout: 30_000 })
			.toBeDefined();
		if (!sentOutboxMessageId) {
			throw new Error("unreachable: the send was matched but not captured");
		}

		await waitForOutboxStatus(api, sentOutboxMessageId, 404);
		openTheGate?.();

		await expect
			.poll(() => rowGoneAt !== undefined, {
				timeout: 60_000,
				message: "the send watch to read the deleted outbox row",
			})
			.toBe(true);

		const polledWhenSettled = polls.length;

		// The defect in two lines: the 404 took the whole screen, and because the
		// overlay is a sibling of the watch rather than above it, the watch that
		// produced the 404 kept going and produced dozens more.
		await expectNoFatalOverlay(page, QUIET_WINDOW_MS);
		expect(polls.length).toBe(polledWhenSettled);

		// And the absence really was settlement, not a give-up: the message left the
		// process and its copy is on the server.
		await waitForAcceptedMessage(subject);
		const filed = await waitFor(
			() => listServerSubjects(run.imapUser, "Sent"),
			(subjects) => subjects.includes(subject),
			{ timeoutMs: 120_000, what: "the Sent copy to be filed on the server" },
		);
		expect(filed).toContain(subject);
	});

	test("reopening the composer on a sent message closes it instead of failing", async () => {
		test.setTimeout(240_000);

		const subject = `Poll settles reopen ${Date.now()}`;
		const { outboxMessageId } = await api.sendMessage({
			accountId: run.accountId,
			toAddresses: ["ada@remit.test"],
			subject,
			textBody: BODY,
		});

		await waitForOutboxStatus(api, outboxMessageId, 404);

		// The draft is a path segment, so this address is what Back after a send
		// lands on, and what a restored tab reopens.
		const page = await context.newPage();
		await page.goto(`/mail/brief/compose/${outboxMessageId}`);

		await expect(page).not.toHaveURL(COMPOSE_URL, { timeout: 30_000 });
		await expectNoFatalOverlay(page);
	});
});
