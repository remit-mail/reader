/**
 * The composer checked against a real dictionary, asserted where it shows: the
 * marks a Dutch dictionary put on the writing surface, the correction that
 * reached the recipient's server, and what a writer is told when the dictionary
 * never arrives.
 *
 * Marks are drawn through the CSS Custom Highlight registry rather than as
 * elements, so there is no node to query — the ranges are read out of the
 * registry itself, which is the same thing the browser paints from. Nothing
 * here asserts that a function was called: a mark is a range over a word, a
 * correction is bytes at the far end of an SMTP session, and a failure is a
 * banner with the browser's own checker switched back on.
 *
 * The shared onboarded account has no SMTP, so these run against an isolated
 * user whose account can reach the sink.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { readMimeShapeOfRaw } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

const RECIPIENT = "recipient@remit.test";

const ACCOUNT_LANGUAGES = ["nl", "en"];

/**
 * One misspelling, in the middle. The caret withholds the mark of the word it
 * sits in, so a typo at the end of what was typed would not be marked yet.
 */
const TYPO = "vergaderingg";

const DUTCH = `Beste Anna, de ${TYPO} van donderdag gaat door.`;

/** Correctly spelt Dutch from the same sentence, which must stay unmarked. */
const SPELT_RIGHT = ["Beste", "donderdag", "gaat"];

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

/**
 * Dutch by hand rather than by detection: what is under test is the dictionary,
 * not the detector, and the pick is what decides which dictionary opens.
 */
const writeDutch = async (page: Page, text: string): Promise<void> => {
	const chip = page.getByTestId("compose-language-chip");
	await chip.click();
	await page.getByRole("menuitemradio", { name: /Nederlands/ }).click();
	await expect(chip).toHaveText("NL");
	await expect(page.getByTestId("compose-body")).toHaveAttribute("lang", "nl");
	await page.getByTestId("compose-body").click();
	await page.keyboard.type(text);
};

/** The words carrying a squiggle right now, read out of the highlight registry. */
const markedWords = (page: Page): Promise<string[]> =>
	page.evaluate(() => {
		const editable = document.querySelector('[data-testid="compose-body"]');
		const words: string[] = [];
		CSS.highlights.forEach((highlight, name) => {
			if (name !== "spell-error") return;
			for (const range of highlight) {
				const start = (range as Range).startContainer;
				if (!editable?.contains(start)) continue;
				words.push(
					(start.textContent ?? "").slice(
						(range as Range).startOffset,
						(range as Range).endOffset,
					),
				);
			}
		});
		return words;
	});

/** Where a marked word sits on screen, so a real click can land on it. */
const markCentre = (
	page: Page,
	word: string,
): Promise<{ x: number; y: number }> =>
	page.evaluate((wanted) => {
		const editable = document.querySelector('[data-testid="compose-body"]');
		for (const [name, highlight] of CSS.highlights) {
			if (name !== "spell-error") continue;
			for (const range of highlight) {
				const marked = range as Range;
				if (!editable?.contains(marked.startContainer)) continue;
				const text = marked.startContainer.textContent ?? "";
				if (text.slice(marked.startOffset, marked.endOffset) !== wanted) {
					continue;
				}
				const box = marked.getBoundingClientRect();
				return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
			}
		}
		throw new Error(`"${wanted}" carries no mark`);
	}, word);

const htmlPartOf = (
	parts: { contentType: string; content: string }[],
): string => {
	const html = parts.find((part) => part.contentType === "text/html");
	if (!html) throw new Error("the message carries no text/html part");
	return html.content;
};

test.describe("The composer's own spellchecker", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Compose Spellcheck");
		api = new ApiClient(run);
		await api.updateAccount(run.accountId, {
			composeLanguages: ACCOUNT_LANGUAGES,
		});
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	// Case 1: a Dutch dictionary marks Dutch, and the browser stops marking it.
	// Two checkers over one paragraph is the failure this replaces — an
	// English-configured Chrome puts a squiggle under every Dutch word.
	test("marks a Dutch typo and takes the browser's checking off", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();

		await openCompose(page, `Spellcheck marks ${Date.now()}`);
		await writeDutch(page, DUTCH);

		// The attribute is the handover: it goes false exactly while a checker of
		// ours is ready, and back to true the moment one is not.
		await expect(page.getByTestId("compose-body")).toHaveAttribute(
			"spellcheck",
			"false",
			{ timeout: 60_000 },
		);

		await expect
			.poll(() => markedWords(page), { timeout: 30_000 })
			.toContain(TYPO);
		// The dictionary is real, so ordinary Dutch has to survive it. A checker
		// that marked everything would satisfy the assertion above.
		expect(await markedWords(page)).not.toContain(SPELT_RIGHT[0]);
		for (const word of SPELT_RIGHT) {
			expect(await markedWords(page)).not.toContain(word);
		}
	});

	// Case 2: the correction the writer picked is the one the recipient reads.
	test("a correction the writer picked is what the recipient receives", async () => {
		test.setTimeout(240_000);
		const page = await context.newPage();
		const subject = `Spellcheck correction ${Date.now()}`;

		await openCompose(page, subject);
		await writeDutch(page, DUTCH);
		await expect
			.poll(() => markedWords(page), { timeout: 60_000 })
			.toContain(TYPO);

		const at = await markCentre(page, TYPO);
		await page.mouse.click(at.x, at.y);

		await expect(page.getByTestId("spell-menu")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("spell-word")).toHaveText(TYPO);

		const first = page.getByTestId("spell-suggestion").first();
		await expect(first).toBeVisible({ timeout: 15_000 });
		const correction = (await first.innerText()).trim();
		expect(correction).not.toBe(TYPO);
		await first.click();

		await expect(page.getByTestId("compose-body")).toContainText(correction);
		await expect(page.getByTestId("compose-body")).not.toContainText(TYPO);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);
		const html = htmlPartOf(delivered.parts);
		expect(html).toContain(correction);
		expect(html).not.toContain(TYPO);
	});

	// Case 6: the dictionary answered, and what it answered was 503. Nothing may
	// fail quietly here — an editor that has stopped marking anything reads
	// exactly like text with nothing wrong in it.
	test("a dictionary that answers 503 is named, reportable, and hands back", async ({
		browser,
	}) => {
		test.setTimeout(180_000);
		const refused = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
		await refused.route(/index\.dic(\.br)?$/, (route) =>
			route.fulfill({ status: 503, body: "service unavailable" }),
		);
		const page = await refused.newPage();

		try {
			await openCompose(page, `Spellcheck refused ${Date.now()}`);
			await writeDutch(page, DUTCH);

			const notice = page.getByTestId("spellcheck-notice");
			await expect(notice).toBeVisible({ timeout: 60_000 });
			// The language names itself the way its own speakers write it.
			await expect(notice).toContainText(
				"The Nederlands dictionary did not load",
			);

			// The status and the file, because "something went wrong" is not
			// something an operator can act on.
			const detail = page.getByTestId("spellcheck-detail");
			await expect(detail).toContainText("answered 503");
			await expect(detail).toContainText("index.dic");

			const report = page.getByTestId("spellcheck-report");
			const href = await report.getAttribute("href");
			expect(href).toContain("issues/new");
			expect(decodeURIComponent(href ?? "")).toContain("answered 503");

			// The browser keeps checking. This is the whole promise of the failure
			// path: the writer loses our dictionary, never their squiggles.
			await expect(page.getByTestId("compose-body")).toHaveAttribute(
				"spellcheck",
				"true",
			);
			expect(await markedWords(page)).toEqual([]);
		} finally {
			await refused.close();
		}
	});
});
