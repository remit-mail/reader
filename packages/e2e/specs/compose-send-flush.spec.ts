/**
 * Issue #674: whatever was typed in the two seconds before Send never reached
 * the recipient. Compose autosaves on a debounce, and pressing Send cancelled
 * the pending timer and then dispatched the outbox entry as the server last saw
 * it. The Sent copy matched what went out, so nothing about the message said a
 * paragraph was missing.
 *
 * The assertion is on the outbox entry rather than on the editor: that entry is
 * the payload the relay hands to SMTP, so it is what a recipient gets. It is
 * read once the entry has left `draft`, which the send endpoint does before it
 * answers — so the copy read back is the one the app committed to sending.
 *
 * The account is provisioned with submission settings, which is what makes the
 * app willing to press Send at all. Nothing on this stack accepts the mail, so
 * delivery fails behind the queue and the message dead-letters; that is
 * downstream of everything asserted here.
 *
 * The window this is about is two seconds wide and nothing enforces it, so the
 * spec times its own last two actions and fails when they overrun rather than
 * passing on an autosave that beat it there.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl, imapFromStack } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };

/** What compose waits before it autosaves, and so the window this spec has. */
const AUTOSAVE_DEBOUNCE_MS = 2_000;

/** Typed first, and given the full debounce to reach the server. */
const SETTLED_LINE = "The first paragraph, saved with time to spare.";

/** Typed last, and followed straight away by Send. This is what used to vanish. */
const LATE_LINE = "One more thing before I forget.";

test.describe("Sending inside the autosave debounce window (#674)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		run = await provisionIsolatedRun("E2E Compose Send Flush", [], {
			// Port 587 on the IMAP host: a plausible submission address that this
			// stack does not answer on.
			smtp: { host: imapFromStack.host, port: 587 },
		});
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

	test("the last edit before Send is in the message that goes out", async () => {
		test.setTimeout(180_000);

		const page = await context.newPage();
		const subject = `Send flush ${Date.now()}`;

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);

		await body.click();
		await page.keyboard.type(SETTLED_LINE);

		// An entry has to exist on the server before the bug can apply: the defect
		// was in the branch that sends an id it already has.
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

		const beforeSend = await api.getOutboxMessage(draft.outboxMessageId);
		expect(beforeSend.status).toBe("draft");
		expect(beforeSend.textBody ?? "").toContain(SETTLED_LINE);
		expect(beforeSend.textBody ?? "").not.toContain(LATE_LINE);

		// Resolved up front so the click below is a click and nothing else.
		const send = page.getByRole("button", { name: "Send", exact: true });
		await expect(send).toBeVisible();

		// The repro: type, then Send, inside the two seconds the next autosave
		// would have waited.
		await page.keyboard.press("Enter");
		await page.keyboard.type(LATE_LINE);
		const typedAt = Date.now();
		await send.click();

		// Had the debounce beaten the click, the entry would carry the last line
		// for a reason that has nothing to do with the fix, and the spec would pass
		// while testing nothing.
		expect(Date.now() - typedAt).toBeLessThan(AUTOSAVE_DEBOUNCE_MS);

		// Compose closing is the app saying the send was accepted.
		await expect(body).toBeHidden({ timeout: 30_000 });

		const dispatched = await waitFor(
			() => api.getOutboxMessage(draft.outboxMessageId),
			(entry) => entry.status !== "draft",
			{ timeoutMs: 60_000, what: "the entry to leave draft" },
		);

		expect(dispatched.textBody ?? "").toContain(SETTLED_LINE);
		expect(dispatched.textBody ?? "").toContain(LATE_LINE);
		expect(dispatched.htmlBody ?? "").toContain(LATE_LINE);
	});
});
