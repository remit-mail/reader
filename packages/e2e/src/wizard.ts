/**
 * The selection wizard, as a spec drives it (#477). Every verb on the selection
 * bar opens it, so these locators are shared rather than re-derived per spec.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The step line under the rail: "Step 2 of 4 · Folder". */
export const wizardStep = (page: Page): Locator =>
	page.getByText(/^Step \d+ of \d+ · /);

export const wizardContinue = (page: Page): Locator =>
	page.getByRole("button", { name: "Continue" });

/** Advance one step and wait for the screen the answer leads to. */
export const advanceTo = async (page: Page, step: string): Promise<void> => {
	await wizardContinue(page).click();
	await expect(wizardStep(page)).toHaveText(new RegExp(` · ${step}$`), {
		timeout: 20_000,
	});
};

/**
 * The announcement a blocked control makes when it is pressed. The reason is on
 * the control the whole time it applies, for anything reading the page through
 * the accessibility tree; the live region it is written into is empty until the
 * press, which is what these two assert either side of.
 */
const announcedReason = (page: Page, reason: string): Locator =>
	page.getByRole("status").filter({ hasText: reason });

export const expectBlockedReason = async (
	page: Page,
	reason: string,
): Promise<void> => {
	await expect(announcedReason(page, reason)).toBeVisible();
};

/** Nothing has been announced yet, because nothing has been pressed. */
export const expectNoBlockedReason = async (
	page: Page,
	reason: string,
): Promise<void> => {
	await expect(announcedReason(page, reason)).toHaveCount(0);
};

/** Pick a destination on the folder step. */
export const pickFolder = async (page: Page, label: string): Promise<void> => {
	await page.getByRole("option", { name: `Move to ${label}` }).click();
};

/** The review screen's commit control, named for what it commits. */
export const commitButton = (page: Page, label: string): Locator =>
	page.getByRole("button", { name: label, exact: true });

/** The run screen's way out, which also drops the selection. */
export const dismissRun = async (page: Page, label = "Done"): Promise<void> => {
	await page.getByRole("button", { name: label, exact: true }).click();
};

/**
 * The bar's verbs. Delete, Move and Organize carry a glyph; Junk and Mark read
 * live in the overflow menu.
 */
export const barDelete = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages to Trash" });

export const barMove = (page: Page): Locator =>
	page.getByRole("button", { name: "Move selected messages", exact: true });

export const barOrganize = (page: Page): Locator =>
	page.getByRole("button", { name: "Organize selected messages" });

export const barOverflowVerb = async (
	page: Page,
	label: string,
): Promise<void> => {
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: label }).click();
};
