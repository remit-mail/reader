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
	expectNothingAccepted,
	readAcceptedEnvelope,
	waitForAcceptedMessage,
} from "../src/smtp-sink.js";

const DESKTOP = { width: 1512, height: 864 };

/** Committed to a chip before Send, and the list a stale send would fall back to. */
const COMMITTED = "committed@remit.test";

/** Typed into the field and left there, which is the whole subject here. */
const TYPED = "typed@remit.test";

/** Typed into Cc and left there. */
const TYPED_CC = "typed-cc@remit.test";

/** Typed into To and left there, and not an address — there is no top-level domain. */
const NOT_AN_ADDRESS = "typed@remit";

/** What the composer says when it reads no recipient at all. */
const NO_RECIPIENT_REFUSAL = "Add a To address before sending.";

/** What it says instead when a field holds text it cannot read as an address. */
const notAnAddressRefusal = (label: string, text: string): string =>
	`${label} holds "${text}", which is not an address.`;

/**
 * Long enough for a send to have reached the sink, had one been made. The suite
 * reads a real submission back in well under this.
 */
const QUIET_WINDOW_MS = 15_000;

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

/** A field itself. Not by placeholder: a chip in To takes the placeholder away. */
const addressField = (page: Page, label: string): Locator =>
	page.locator(`[data-address-field="${label}"] input`);

const toField = (page: Page): Locator => addressField(page, "To");

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

	// Cc is the same field under a different label, and a message copied to
	// somebody is a claim about who received it, so it is read off the sink too.
	test("an address left in Cc is copied to as well", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Uncommitted cc ${Date.now()}`;

		await openCompose(page, subject);
		await toField(page).fill(COMMITTED);
		await toField(page).press("Enter");
		await expect(chips(page)).toHaveCount(1);

		await page.getByRole("button", { name: "Cc", exact: true }).click();
		await addressField(page, "Cc").fill(TYPED_CC);
		await page.getByRole("button", { name: "Send", exact: true }).click();

		await expect(page.getByTestId("compose-body")).toBeHidden({
			timeout: 30_000,
		});

		const envelope = await acceptedEnvelope(subject);
		expect(envelope.to).toEqual([COMMITTED]);
		expect(envelope.cc).toEqual([TYPED_CC]);
		expect(envelope.bcc).toEqual([]);
	});

	/**
	 * The other half of taking what is on screen: text that is not an address
	 * cannot be sent to and must not be thrown away either. The send stops, the
	 * text is named and left in the field, and nothing reaches the sink — read
	 * over a window, because an absence checked on the instant of a refusal never
	 * had the chance to be anything else.
	 */
	test("text that is not an address stops the send and is named", async () => {
		test.setTimeout(180_000);
		const page = await context.newPage();
		const subject = `Uncommitted unparseable ${Date.now()}`;

		await openCompose(page, subject);
		await typeAndSend(page, NOT_AN_ADDRESS, 0);

		await expect(
			page.getByText(notAnAddressRefusal("To", NOT_AN_ADDRESS)),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByTestId("compose-body")).toBeVisible();
		await expect(toField(page)).toHaveValue(NOT_AN_ADDRESS);
		await expect(page.getByText(NO_RECIPIENT_REFUSAL)).toHaveCount(0);

		await expectNothingAccepted(subject, QUIET_WINDOW_MS);
	});
});
