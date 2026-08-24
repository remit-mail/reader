/**
 * The recipient that was typed but never turned into a chip (#845.6).
 *
 * The address field commits what is in it on blur, behind a 150 ms timer. Send
 * is a press somewhere else, so the press is what blurs the field — the timer
 * starts on the way to the click and the send reads the recipient list as it
 * stood before the address was typed. Nothing arranges that here and nothing
 * has to: the DOM order is blur, then click, then the timer, so the press
 * always lands inside the window.
 *
 * The reader is given no sign either way. With a chip already there the send is
 * ready, goes to fewer people than were addressed, and the composer closes on
 * it. With none, the same press is refused for having no recipient while the
 * address is on screen.
 *
 * Both are claims about who the submission was for, so both are read off the
 * sink rather than off the composer.
 */

import type { BrowserContext, Locator, Page } from "@playwright/test";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";
import {
	type AcceptedEnvelope,
	readAcceptedEnvelope,
	waitForAcceptedMessage,
} from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

/** Committed to a chip before Send, and the list a stale send would fall back to. */
const COMMITTED = "committed@remit.test";

/** Typed into the field and left there, which is the whole subject here. */
const TYPED = "typed@remit.test";

/** What the composer says when it reads no recipient at all. */
const NO_RECIPIENT_REFUSAL = "Add a To address before sending.";

const openCompose = async (page: Page, subject: string): Promise<void> => {
	await page.goto("/mail");
	await page.getByRole("button", { name: "Compose", exact: true }).click();
	await expect(page.getByTestId("compose-body")).toBeVisible({
		timeout: 30_000,
	});
	await page.locator("[data-subject-field]").fill(subject);
	await page.getByTestId("compose-body").click();
	await page.keyboard.type("Addressed in the field, not in a chip.");
};

/** The chips in To — a precondition here, never the thing being asserted. */
const chips = (page: Page): Locator =>
	page.locator('[data-address-field="To"]').getByRole("button", {
		name: /^Remove /,
	});

/** The field itself. Not by placeholder: a chip in To takes the placeholder away. */
const toField = (page: Page): Locator =>
	page.locator('[data-address-field="To"] input');

/**
 * Type an address, leave it uncommitted, and press Send.
 *
 * The count is read first, so a run where the field had already committed what
 * was typed fails as the setup it is rather than passing as the behaviour it
 * is not.
 */
const typeAndSend = async (
	page: Page,
	address: string,
	committedChips: number,
): Promise<void> => {
	await toField(page).fill(address);
	await expect(chips(page)).toHaveCount(committedChips);
	await page.getByRole("button", { name: "Send", exact: true }).click();
};

const acceptedEnvelope = async (subject: string): Promise<AcceptedEnvelope> => {
	const accepted = await waitForAcceptedMessage(subject);
	return readAcceptedEnvelope(accepted.id);
};

test.describe("Sending with a recipient that is typed but not committed (#845.6)", () => {
	let run: IsolatedRun;
	let context: BrowserContext;

	test.beforeAll(async ({ browser }) => {
		test.setTimeout(180_000);
		run = await provisionIsolatedRun("E2E Uncommitted Recipient");
		context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
	});

	test.afterAll(async () => {
		await context.close();
	});

	test("the only address in the field is the address it goes to", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Uncommitted only ${Date.now()}`;

		await openCompose(page, subject);
		await typeAndSend(page, TYPED, 0);

		// Compose closing is the app saying it accepted the send, so a refusal
		// fails here first and says so; the sentence is asserted after, on a
		// composer that has already gone, because that refusal is the shape this
		// test is about.
		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});
		await expect(page.getByText(NO_RECIPIENT_REFUSAL)).toHaveCount(0);

		const envelope = await acceptedEnvelope(subject);
		expect(envelope.to).toEqual([TYPED]);
		expect(envelope.cc).toEqual([]);
		expect(envelope.bcc).toEqual([]);
	});

	test("an address typed after a chip is a recipient too", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Uncommitted second ${Date.now()}`;

		await openCompose(page, subject);
		await toField(page).fill(COMMITTED);
		await toField(page).press("Enter");
		await expect(chips(page)).toHaveCount(1);

		await typeAndSend(page, TYPED, 1);

		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		// Both, sorted: the send that reads the list as it stood before the last
		// address was typed carries the chip alone, and closes the composer on it
		// as if the message had gone where it was addressed.
		const envelope = await acceptedEnvelope(subject);
		expect([...envelope.to].sort()).toEqual([COMMITTED, TYPED].sort());
		expect(envelope.bcc).toEqual([]);
	});
});
