/**
 * After #675 only the first row of text in the composer accepted a click. The
 * editable was as tall as its own content, so the rest of the body region was
 * inert canvas over a parent that cannot take focus.
 *
 * The click here is a real mouse press low in the body region, far below the
 * last line. What it has to produce is what every mail client produces: the
 * editor takes focus and the caret sits at the end of the document.
 */

import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

const AUTOSAVE_SETTLE_MS = 4_000;
const BELOW_THE_LAST_LINE = 12;

test.describe("Clicking in the compose body", () => {
	test.setTimeout(120_000);

	test("a click below the text focuses the editor and types at the end", async ({
		api,
		page,
	}) => {
		const subject = `Body click ${Date.now()}`;

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);

		// Compose opens with the caret in the recipient field, so the click below
		// is what has to put it in the editor.
		await expect(body).not.toBeFocused();

		const area = page.getByTestId("compose-body-area");
		const box = await area.boundingBox();
		if (!box) throw new Error("the compose body area has no box");
		const lowInTheBody = {
			x: box.width / 2,
			y: box.height - BELOW_THE_LAST_LINE,
		};

		await area.click({ position: lowInTheBody });
		await expect(body).toBeFocused();

		await page.keyboard.type("Alpha");
		await page.keyboard.press("Enter");
		await page.keyboard.type("Beta");
		await expect(body.locator("p").filter({ hasText: "Beta" })).toContainText(
			"Beta",
		);

		// Clicking under the last line continues the document rather than
		// restarting it.
		await page.locator("[data-subject-field]").click();
		await expect(body).not.toBeFocused();
		await area.click({ position: lowInTheBody });
		await page.keyboard.type("!");

		await expect(
			body.locator("p").filter({ hasText: "Beta" }).first(),
		).toContainText("Beta!");

		// A click on existing text still places the caret where it landed.
		const alpha = body.locator("p").filter({ hasText: "Alpha" }).first();
		const alphaBox = await alpha.boundingBox();
		if (!alphaBox) throw new Error("the first line has no box");
		await alpha.click({
			position: { x: alphaBox.width - 4, y: alphaBox.height / 2 },
		});
		await page.keyboard.type("?");

		await expect(
			body.locator("p").filter({ hasText: "Alpha" }).first(),
		).toContainText("Alpha?");
		await expect(
			body.locator("p").filter({ hasText: "Beta" }).first(),
		).toContainText("Beta!");

		await page.waitForTimeout(AUTOSAVE_SETTLE_MS);

		const drafts = await waitFor(
			() => api.listRemovableOutboxMessages(),
			(items) => items.some((item) => item.subject === subject),
			{ timeoutMs: 30_000, what: "the typed draft to autosave" },
		);
		const draft = drafts.find((item) => item.subject === subject);
		if (!draft) throw new Error("unreachable: the draft was matched but lost");

		try {
			const saved = await api.getOutboxMessage(draft.outboxMessageId);
			expect(saved.textBody ?? "").toContain("Alpha?");
			expect(saved.textBody ?? "").toContain("Beta!");
		} finally {
			await api.deleteOutboxMessage(draft.outboxMessageId);
		}
	});
});
