/**
 * The language a message was written in, asserted where it survives: on the
 * writing surface, on the bytes the recipient's server accepted, and on the
 * copy filed in Sent.
 *
 * A page cannot choose the browser's spellcheck dictionary — Chrome and Safari
 * ignore `lang` outright — so nothing here asserts an underline moved. What the
 * tag buys is a Firefox dictionary where one is installed, a screen-reader
 * voice, and a message the recipient's client can read the language off. Issue
 * #686.
 *
 * The shared onboarded account has no SMTP, so these run against an isolated
 * user whose account can reach the sink, and every draft this spec creates is
 * deleted again rather than left in the shared outbox.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { readMimeShape, readMimeShapeOfRaw } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };
const PHONE = { width: 390, height: 844 };

const RECIPIENT = "recipient@remit.test";

/** Most-used first: the chip opens on `nl`, and detection chooses among all three. */
const ACCOUNT_LANGUAGES = ["nl", "en", "de"];

const DUTCH =
	"Beste Anna, de vergadering van donderdag gaat niet door. Ik stuur je morgen een nieuw voorstel voor de planning.";

const FRENCH_PASSAGE =
	'<p lang="fr">Bonjour Anna, la réunion de jeudi est annulée.</p>';

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

/** The HTML alternative of a message, or the single part when there is only one. */
const htmlPartOf = (
	parts: { contentType: string; content: string }[],
): string => {
	const html = parts.find((part) => part.contentType === "text/html");
	if (!html) throw new Error("the message carries no text/html part");
	return html.content;
};

test.describe("The language a message is written in", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Compose Language");
		api = new ApiClient(run);

		// The candidate set is the account setting, pinned here rather than left to
		// the fallback: these specs pick German out of a menu, and the fallback
		// offers the browser's own languages and the staged dictionaries alone.
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

	test("a message written in Dutch goes out tagged Dutch", async () => {
		test.setTimeout(240_000);
		const page = await context.newPage();
		const subject = `Language dutch ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(DUTCH);

		const chip = page.getByTestId("compose-language-chip");
		await expect(chip).toHaveText("NL", { timeout: 15_000 });
		await expect(page.getByTestId("compose-body")).toHaveAttribute(
			"lang",
			"nl",
		);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);
		expect(htmlPartOf(delivered.parts).trim()).toMatch(/^<div lang="nl">/);

		// The Sent copy is built by the same builder (#689) but travels a separate
		// path, so the sender's own archive is asserted rather than assumed.
		const filed = await waitFor(
			() => readMimeShape(run.imapUser, "Sent", subject),
			(shape) => shape !== null,
			{ timeoutMs: 120_000, what: "the Sent copy to be filed on the server" },
		);
		if (!filed) throw new Error("unreachable: the Sent copy was matched");
		expect(htmlPartOf(filed.parts).trim()).toMatch(/^<div lang="nl">/);
	});

	test("a language picked by hand is the one that ships", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Language picked ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(DUTCH);

		const chip = page.getByTestId("compose-language-chip");
		await expect(chip).toHaveText("NL", { timeout: 15_000 });

		await chip.click();
		await page.getByRole("menuitemradio", { name: /Deutsch/ }).click();
		await expect(chip).toHaveText("DE");

		// The body stays Dutch, so a detector still running would move the chip
		// back. The pick is what has to survive.
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(" Groetjes, Matthijs.");
		await expect(chip).toHaveText("DE");

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);
		const html = htmlPartOf(delivered.parts).trim();
		expect(html).toMatch(/^<div lang="de">/);
		expect(html).not.toContain('lang="nl"');
	});

	test("a reopened draft comes back in its own language, wrapped once", async () => {
		test.setTimeout(240_000);
		const page = await context.newPage();
		const subject = `Language draft ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-body").click();

		// Three separate bursts, each past the two-second autosave debounce, so the
		// draft is written three times. A wrapper added per save would nest.
		for (const burst of [
			DUTCH,
			" Neem gerust contact op als dat niet uitkomt.",
			" Groetjes, Matthijs.",
		]) {
			await page.keyboard.type(burst);
			await expect(page.getByText("Draft saved")).toBeVisible({
				timeout: 30_000,
			});
		}

		const drafts = await waitFor(
			() => api.listRemovableOutboxMessages(),
			(items) => items.some((item) => item.subject === subject),
			{ timeoutMs: 30_000, what: "the draft to autosave" },
		);
		const draft = drafts.find((item) => item.subject === subject);
		if (!draft) throw new Error("unreachable: the draft was matched but lost");

		try {
			const saved = await waitFor(
				() => api.getOutboxMessage(draft.outboxMessageId),
				(message) => (message.htmlBody ?? "").includes("Groetjes"),
				{ timeoutMs: 30_000, what: "the last burst to reach the server" },
			);
			const html = saved.htmlBody ?? "";
			expect(html).toMatch(/^<div lang="nl">/);
			expect(html.match(/<div lang=/g)?.length).toBe(1);

			const mailboxes = await waitFor(
				() => api.listMailboxes(run.accountId),
				(boxes) => boxes.some((box) => box.fullPath === "Drafts"),
				{ timeoutMs: 90_000, what: "the Drafts folder to sync" },
			);
			const drafted = mailboxes.find((box) => box.fullPath === "Drafts");
			if (!drafted) throw new Error("unreachable: Drafts was matched");

			await page.goto(`/mail/${drafted.mailboxId}`);
			await page.getByText(subject).first().click();

			const reopened = page.getByTestId("compose-body");
			await expect(reopened).toBeVisible({ timeout: 30_000 });
			await expect(page.getByTestId("compose-language-chip")).toHaveText("NL");
			await expect(reopened).toContainText("Groetjes, Matthijs.");
			// The editor reopens on what was inside the wrapper, never on the
			// wrapper itself.
			await expect(reopened.locator("div[lang]")).toHaveCount(0);
		} finally {
			await api.deleteOutboxMessage(draft.outboxMessageId);
		}
	});

	test("a plain-text message carries no wrapper at all", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Language plain ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(DUTCH);
		await expect(page.getByTestId("compose-language-chip")).toHaveText("NL", {
			timeout: 15_000,
		});

		await page.getByTestId("compose-mode-toggle").click();
		const plain = page.getByTestId("compose-body-plain");
		await expect(plain).toBeVisible();
		// The tag rides whichever surface is up, and the chip does not move with
		// the mode.
		await expect(plain).toHaveAttribute("lang", "nl");
		await expect(page.getByTestId("compose-language-chip")).toHaveText("NL");

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(plain).toBeHidden({ timeout: 30_000 });

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);

		expect(delivered.contentType).toBe("text/plain");
		expect(delivered.parts[0].content).toContain("Beste Anna");
		// A plain message has no HTML to carry a tag, and the wrapper the rich
		// body was written under must not ride along as a second alternative.
		expect(accepted.raw).not.toContain("text/html");
		expect(accepted.raw).not.toContain("<div lang");
	});

	/**
	 * A pasted passage in another language keeps its own tag through the paste
	 * profile, but Lexical's document model has nowhere to hold it — its element
	 * nodes carry no language — so what reaches the wire is the message's own
	 * tag. Asserted so a later change to that (issue #692's territory) is a
	 * visible change and not a surprise.
	 */
	test("a pasted French passage still ships under the message's own tag", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Language paste ${Date.now()}`;

		await openCompose(page, subject);
		await page.getByTestId("compose-body").click();
		await page.keyboard.type(DUTCH);
		await expect(page.getByTestId("compose-language-chip")).toHaveText("NL", {
			timeout: 15_000,
		});

		await page.evaluate((html) => {
			const element = document.querySelector('[data-testid="compose-body"]');
			if (!element) throw new Error("compose-body is not mounted");
			const data = new DataTransfer();
			data.setData("text/html", html);
			data.setData("text/plain", "Bonjour Anna");
			element.dispatchEvent(
				new ClipboardEvent("paste", {
					bubbles: true,
					cancelable: true,
					clipboardData: data,
				}),
			);
		}, FRENCH_PASSAGE);
		await expect(page.getByTestId("compose-body")).toContainText(
			"Bonjour Anna",
		);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		const accepted = await waitForAcceptedMessage(subject);
		const delivered = await readMimeShapeOfRaw(accepted.raw);
		const html = htmlPartOf(delivered.parts).trim();

		expect(html).toMatch(/^<div lang="nl">/);
		expect(html).toContain("Bonjour Anna");
		expect(html.match(/<div lang=/g)?.length).toBe(1);
	});

	test("both pinned controls stay reachable at 390", async ({ browser }) => {
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

			// The cluster has to actually run out of room, or the assertions below
			// pass on a toolbar that never needed to scroll.
			const overflows = await phone
				.getByTestId("compose-format-cluster")
				.evaluate((element) => element.scrollWidth > element.clientWidth);
			expect(overflows).toBe(true);

			for (const testId of ["compose-language-chip", "compose-mode-toggle"]) {
				const box = await phone.getByTestId(testId).boundingBox();
				expect(box).not.toBeNull();
				expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
				expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
					PHONE.width,
				);
				await expect.poll(() => isOnTop(phone, testId)).toBe(true);
			}
		} finally {
			await phoneContext.close();
		}
	});
});
