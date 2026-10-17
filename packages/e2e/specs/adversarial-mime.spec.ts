import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";
import { ApiClient } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { appendRawMessage } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { MAILBOX_THREAD_URL } from "../src/urls.js";

const FIXTURES_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"../fixtures/mime-adversarial",
);

interface FixtureExpectation {
	subject: string;
	attachments: string[];
	bodyContains: string;
}

const EXPECTATIONS: Record<string, FixtureExpectation> = {
	"01-octet-stream-pdf.eml": {
		subject: "Adversarial fixture 01 octet-stream PDF (Odido shape, #394)",
		attachments: ["contract.pdf"],
		bodyContains: "contract PDF",
	},
	"02-nested-related-cid-image.eml": {
		subject: "Adversarial fixture 02 nested related html + cid image",
		attachments: ["invoice.pdf"],
		bodyContains: "Inline logo",
	},
	"03-calendar-invite.eml": {
		subject: "Adversarial fixture 03 calendar invite + html",
		attachments: ["invite.ics"],
		bodyContains: "Meeting invite",
	},
	"04-forwarded-rfc822-with-attachments.eml": {
		subject: "Adversarial fixture 04 forwarded rfc822 with inner attachment",
		attachments: ["forwarded.eml"],
		bodyContains: "Forwarding",
	},
	"05-tnef-winmail.eml": {
		subject: "Adversarial fixture 05 Outlook TNEF winmail.dat",
		attachments: ["winmail.dat"],
		bodyContains: "TNEF",
	},
	"06-8bit-non-ascii.eml": {
		subject: "Café façade - adversarial fixture 06",
		attachments: [],
		bodyContains: "café",
	},
	"07-quoted-printable-soft-breaks.eml": {
		subject: "Adversarial fixture 07 quoted-printable with soft line breaks",
		attachments: [],
		// Split across a soft line break in the encoded source; only a decoded
		// quoted-printable body reassembles it.
		bodyContains: "single logical line",
	},
	"08-alternative-empty-text.eml": {
		subject: "Adversarial fixture 08 alternative with empty text/plain",
		attachments: [],
		// text/plain is empty, so what renders has to be the html alternative.
		bodyContains: "intentionally empty",
	},
};

/** Every text the reading pane shows, its own document and the body frame alike. */
const renderedText = async (page: Page): Promise<string> => {
	const texts = await Promise.all(
		page.frames().map((frame) =>
			frame
				.locator("body")
				.innerText({ timeout: 2_000 })
				.catch(() => ""),
		),
	);
	return texts.join("\n").toLowerCase();
};

test.describe("Adversarial MIME read back through reader", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(300_000);
		run = await provisionIsolatedRun("E2E Adversarial MIME");
		api = new ApiClient(run);
		for (const name of Object.keys(EXPECTATIONS)) {
			await appendRawMessage(
				run.imapUser,
				readFileSync(join(FIXTURES_DIR, name), "utf8"),
			);
		}
		await api.triggerSync(run.accountId);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("every fixture on disk has an expectation", () => {
		const onDisk = readdirSync(FIXTURES_DIR)
			.filter((name) => name.endsWith(".eml"))
			.sort();
		expect(onDisk).toEqual(Object.keys(EXPECTATIONS).sort());
	});

	for (const [name, expectation] of Object.entries(EXPECTATIONS)) {
		test(`${name} syncs its attachments and renders its body`, async () => {
			test.setTimeout(180_000);
			const messageId = await api.messageIdForSubject(
				run.inboxId,
				expectation.subject,
			);

			const parts = await api.describeMessageParts(messageId);
			const attached = parts.filter(
				(part) => part.disposition === "attachment",
			);
			expect(attached.map((part) => part.dispositionFilename)).toEqual(
				expect.arrayContaining(expectation.attachments),
			);
			for (const part of attached) {
				expect(part.sizeOctets).toBeGreaterThan(0);
			}

			const page = await context.newPage();
			await page.goto(`/mail/${run.inboxId}`);
			await page
				.getByText(expectation.subject, { exact: true })
				.first()
				.click();
			await page.waitForURL(MAILBOX_THREAD_URL);
			await expect(page.getByRole("article").first()).toBeVisible({
				timeout: 30_000,
			});
			await expect
				.poll(() => renderedText(page), { timeout: 60_000 })
				.toContain(expectation.bodyContains.toLowerCase());
			await page.close();
		});
	}
});
