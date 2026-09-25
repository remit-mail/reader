/**
 * Issue #679: a composed message could not carry a file.
 *
 * The file is picked in the composer, and what is asserted is what the mail
 * server holds afterwards — the bytes the SMTP sink accepted, parsed by Dovecot,
 * and the copy filed in the sender's Sent folder. Both are built from the same
 * outbox rows by different workers, so each one is read on its own.
 *
 * The same composer is first handed a file over the per-message cap, which the
 * server refuses before a byte moves. The refusal has to reach the row that
 * asked, naming the limit, and has to keep the message from going out until the
 * file is removed.
 */

import type { BrowserContext } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import {
	type MimeShape,
	readMimeShape,
	readMimeShapeOfRaw,
} from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import { waitForAcceptedMessage } from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

const ATTACHED = {
	name: "board-pack.pdf",
	mimeType: "application/pdf",
	content: "%PDF-1.4\nRemit e2e outbound attachment\n%%EOF\n",
};

const OVER_LIMIT = {
	name: "site-survey.bin",
	mimeType: "application/octet-stream",
	sizeBytes: 26 * 1024 * 1024,
};

const attachedPart = (shape: MimeShape) =>
	shape.parts.find((part) => part.filename === ATTACHED.name);

test.describe("Attaching a file to a message (#679)", () => {
	let run: IsolatedRun;
	let api: ApiClient;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Compose Attach");
		api = new ApiClient(run);
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});

		await waitFor(
			() => api.listMailboxes(run.accountId),
			(boxes) => boxes.some((box) => box.fullPath === "Sent"),
			{ timeoutMs: 90_000, what: "the Sent folder to sync" },
		);
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("the file goes out as a part of the message and is filed with it in Sent", async () => {
		test.setTimeout(300_000);

		const page = await context.newPage();
		const subject = `Compose attach ${Date.now()}`;

		await page.goto("/mail");
		await page.getByRole("button", { name: "Compose", exact: true }).click();

		const body = page.getByTestId("compose-body");
		await expect(body).toBeVisible({ timeout: 30_000 });

		await page.getByPlaceholder("Recipients").fill("ada@remit.test");
		await page.getByPlaceholder("Recipients").press("Enter");
		await page.locator("[data-subject-field]").fill(subject);
		await body.click();
		await page.keyboard.type("The board pack is attached.");

		const picker = page.getByTestId("compose-attach-input");
		const rows = page.getByTestId("compose-attachment");

		await picker.setInputFiles({
			name: OVER_LIMIT.name,
			mimeType: OVER_LIMIT.mimeType,
			buffer: Buffer.alloc(OVER_LIMIT.sizeBytes),
		});
		const refused = rows.filter({ hasText: OVER_LIMIT.name });
		await expect(refused).toHaveAttribute("data-state", "failed", {
			timeout: 30_000,
		});
		await expect(refused.getByRole("alert")).toContainText(
			"over the 25.0 MB a message can carry",
		);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(
			page.getByText(`"${OVER_LIMIT.name}" is not attached`),
		).toBeVisible();
		await expect(body).toBeVisible();

		await page
			.getByRole("button", { name: `Remove ${OVER_LIMIT.name}` })
			.click();
		await expect(refused).toHaveCount(0);

		await picker.setInputFiles({
			name: ATTACHED.name,
			mimeType: ATTACHED.mimeType,
			buffer: Buffer.from(ATTACHED.content),
		});
		await expect(rows.filter({ hasText: ATTACHED.name })).toHaveAttribute(
			"data-state",
			"attached",
			{ timeout: 30_000 },
		);

		await page.getByRole("button", { name: "Send", exact: true }).click();
		await expect(body).toBeHidden({ timeout: 30_000 });

		const accepted = await waitForAcceptedMessage(subject);
		const wire = await readMimeShapeOfRaw(accepted.raw);
		expect(wire.contentType).toBe("multipart/mixed");
		expect(attachedPart(wire)).toEqual({
			contentType: ATTACHED.mimeType,
			filename: ATTACHED.name,
			content: ATTACHED.content,
		});

		const filed = await waitFor(
			() => readMimeShape(run.imapUser, "Sent", subject),
			(shape) => shape !== null,
			{ timeoutMs: 120_000, what: "the Sent copy to be filed on the server" },
		);
		if (!filed)
			throw new Error("unreachable: the Sent copy was matched as present");
		expect(filed.contentType).toBe("multipart/mixed");
		expect(attachedPart(filed)).toEqual(attachedPart(wire));
	});
});
