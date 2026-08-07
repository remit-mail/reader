/**
 * Issue #674: whatever was typed in the two seconds before Send never reached
 * the recipient. Compose autosaves on a debounce, and pressing Send cancelled
 * the pending timer and then dispatched the outbox entry as the server last saw
 * it. The Sent copy matched what went out, so nothing about the message said a
 * paragraph was missing.
 *
 * The outbox entry is read before Send, to establish that the server is holding
 * a copy without the last line — the defect was in the branch that dispatches an
 * id it already has, so an entry has to exist for it to apply.
 *
 * What is asserted after Send is the message the SMTP sink accepted. The entry
 * cannot be read there any more: a send that succeeds is APPENDed to Sent and
 * the row is dropped, so polling it races a delete. Reading the wire instead is
 * also the stronger claim — the late line reached a recipient, not merely a
 * database row on the way to one.
 *
 * The window this is about is two seconds wide and nothing enforces it, so the
 * spec times its own last two actions and fails when they overrun rather than
 * passing on an autosave that beat it there.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { readMimeShapeOfRaw } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

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
		run = await provisionIsolatedRun("E2E Compose Send Flush");
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

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);
		const part = (contentType: string): string =>
			delivered.parts.find((candidate) => candidate.contentType === contentType)
				?.content ?? "";

		// Both bodies, because compose writes both and the bug dropped the last
		// line from whichever one the server happened to be holding.
		expect(part("text/plain")).toContain(SETTLED_LINE);
		expect(part("text/plain")).toContain(LATE_LINE);
		expect(part("text/html")).toContain(LATE_LINE);
	});
});
