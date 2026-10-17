/**
 * A forwarded message carried whole (message/rfc822) is an attachment of the
 * mail that carries it: listed under its own name, saved as the raw message,
 * and opened in place. The PDF inside it belongs to the forwarded message, so
 * the carrying mail does not list it.
 *
 * Adversarial fixture 04 is APPENDed to Dovecot as-is, so the chain under test
 * is the real one: BODYSTRUCTURE, part storage, the content route and the
 * reading pane.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { appendRawMessage } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const FIXTURE = readFileSync(
	join(
		dirname(fileURLToPath(import.meta.url)),
		"../fixtures/mime-adversarial/04-forwarded-rfc822-with-attachments.eml",
	),
	"utf8",
);
const SUBJECT = "Adversarial fixture 04 forwarded rfc822 with inner attachment";

/** The forwarded message exactly as the fixture carries it, between its part headers and the outer boundary. */
const FORWARDED_SOURCE = (() => {
	const [, afterHeaders] = FIXTURE.split(
		'Content-Disposition: attachment; filename="forwarded.eml"\n\n',
	);
	if (!afterHeaders) throw new Error("fixture 04 has no forwarded part");
	return afterHeaders.slice(0, afterHeaders.indexOf("\n--=_adv04_outer_=--"));
})();

const unixLines = (text: string): string => text.replace(/\r\n/g, "\n");

let run: IsolatedRun;
let api: ApiClient;
let context: BrowserContext;

const openFixture = async (page: Page): Promise<Locator> => {
	await page.goto(`/mail/${run.inboxId}`);
	await page.getByText(SUBJECT, { exact: true }).first().click();
	await page.waitForURL(MAILBOX_THREAD_URL);
	const article = page.getByRole("article").first();
	await expect(article).toBeVisible({ timeout: 30_000 });
	const list = article.getByTestId("attachment-list").first();
	await expect(list).toBeVisible({ timeout: 30_000 });
	return list;
};

test.beforeAll(async ({ browser }) => {
	test.setTimeout(300_000);
	run = await provisionIsolatedRun("E2E Forwarded Message");
	api = new ApiClient(run);
	await appendRawMessage(run.imapUser, FIXTURE);
	await api.triggerSync(run.accountId);
	await api.messageIdForSubject(run.inboxId, SUBJECT);
	context = await browser.newContext({
		storageState: run.storageState,
		baseURL: baseUrl,
	});
});

test.afterAll(async () => {
	await context.close();
});

test.describe("A forwarded message attached to a received mail", () => {
	test("the mail lists the forwarded message, not the attachment inside it", async () => {
		const page = await context.newPage();
		const list = await openFixture(page);

		await expect(list.getByRole("heading").first()).toHaveText("1 attachment");
		await expect(
			list.getByRole("button", { name: "Open forwarded.eml" }),
		).toBeVisible();
		await expect(list.getByText("original.pdf", { exact: true })).toHaveCount(
			0,
		);
		await page.close();
	});

	test("downloading the forwarded message saves the raw message", async () => {
		const page = await context.newPage();
		const list = await openFixture(page);

		const [download] = await Promise.all([
			page.waitForEvent("download"),
			list.getByRole("button", { name: "Download forwarded.eml" }).click(),
		]);

		expect(download.suggestedFilename()).toBe("forwarded.eml");
		const saved = readFileSync(await download.path(), "utf8");
		expect(unixLines(saved).trimEnd()).toBe(FORWARDED_SOURCE.trimEnd());
		await page.close();
	});

	test("opening the forwarded message shows its body and its own attachment", async () => {
		const page = await context.newPage();
		const list = await openFixture(page);

		await list.getByRole("button", { name: "Open forwarded.eml" }).click();
		const forwarded = list.getByTestId("forwarded-message");
		await expect(forwarded).toBeVisible();
		await expect(
			forwarded.getByRole("button", { name: "Download original.pdf" }),
		).toBeVisible({ timeout: 30_000 });
		await expect
			.poll(
				async () => {
					const texts = await Promise.all(
						page.frames().map((frame) =>
							frame
								.locator("body")
								.innerText({ timeout: 2_000 })
								.catch(() => ""),
						),
					);
					return texts.join("\n");
				},
				{ timeout: 60_000 },
			)
			.toContain("Original message body before forwarding.");

		const [download] = await Promise.all([
			page.waitForEvent("download"),
			forwarded.getByRole("button", { name: "Download original.pdf" }).click(),
		]);
		expect(readFileSync(await download.path(), "utf8")).toBe(
			"%PDF-1.4\n%adv 04 inner pdf\n%EOF\n",
		);
		await page.close();
	});
});
