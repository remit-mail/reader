/**
 * Regression cover for issue #306 — the inbox category filter showed an empty
 * list on a mailbox holding thousands of matching messages.
 *
 * The filter ran in the browser over whatever pages had loaded, so it could only
 * find mail in the newest page. On the instance the bug was reported from, INBOX
 * held 14,187 messages of which 4,753 were `personal`, but the newest 100 held
 * two: selecting Personal filtered fifty rows that contained none of them.
 *
 * The mailbox seeded here is that shape at the smallest size that reproduces it:
 * 55 automated messages newer than 5 personal ones, so the whole match set lies
 * beyond the first page of 50. A filter running over loaded pages returns
 * nothing here; a filter the server answers returns all five.
 *
 * The fixtures are seeded before the account is connected. Category is not
 * settable — it is inferred from headers at body sync — so the header pairs come
 * from `classification-fixtures.ts`, and mail appended after onboarding does not
 * reliably reach the classification path on a triggered sync. Classification is
 * waited for through the API before the UI is driven, so a slow body sync
 * (issue #290) fails as itself rather than as a filter defect.
 */
import type { Page } from "@playwright/test";
import { ApiClient, waitFor } from "../src/api.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";
import type { Message } from "../src/imap.js";
import { type IsolatedRun, provisionIsolatedRun } from "../src/provision.js";

const DESKTOP = { width: 1512, height: 864 };

const STAMP = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 60 total is the least that exceeds `DEFAULT_THREADS_PAGE_SIZE` (50), which
 *  is the whole point: the matches have to sit past the first page. */
const BULK_COUNT = 55;
const RARE_COUNT = 5;

const bulkSubjects = Array.from(
	{ length: BULK_COUNT },
	(_, i) => `E2E Automated ${STAMP} #${i + 1}`,
);
const rareSubjects = Array.from(
	{ length: RARE_COUNT },
	(_, i) => `E2E Personal ${STAMP} #${i + 1}`,
);

/** The npm shape from `classification-fixtures.ts`: one-to-one machine mail
 *  with no List-* headers, classified `automated`. */
const bulkSeed: Message[] = bulkSubjects.map((subject, i) => ({
	subject,
	from: "npm <notifications@npmjs.test>",
	headers: [["Feedback-ID", "1.eu-west-1.abc:AmazonSES"] as const],
	date: new Date(STAMP - (BULK_COUNT - i) * HOUR),
}));

/** A person writing to a person: the classifier's `personal` control. Dated
 *  older than every automated message, so none of these reaches the first page. */
const rareSeed: Message[] = rareSubjects.map((subject, i) => ({
	subject,
	from: "Alice <alice@friends.test>",
	date: new Date(STAMP - (10 + i) * DAY),
}));

const row = (page: Page) => page.locator("[data-message-row]");

const selectCategory = async (page: Page, label: string) => {
	await page.getByRole("button", { name: label, exact: true }).click();
};

test.describe("Inbox category filter", () => {
	let run: IsolatedRun;
	let api: ApiClient;

	test.beforeAll(async () => {
		// Sixty IMAP appends and a first sync, against the suite's 60s default.
		test.setTimeout(300_000);
		run = await provisionIsolatedRun("E2E Inbox Category Filter", [
			...rareSeed,
			...bulkSeed,
		]);
		api = new ApiClient(run);
	});

	test("a category whose mail sits below the newest page still lists (#306)", async ({
		browser,
	}) => {
		test.setTimeout(600_000);

		const threads = await waitFor(
			() => api.searchThreads(run.inboxId),
			(items) =>
				items.length >= BULK_COUNT + RARE_COUNT &&
				items.every((t) => t.category && t.category !== "uncategorized"),
			{
				timeoutMs: 420_000,
				intervalMs: 5_000,
				what: "every seeded message to be body-classified",
			},
		);

		// Server truth: the mail is there, and the shape that broke the filter is
		// the shape this mailbox has.
		expect(threads.filter((t) => t.category === "personal")).toHaveLength(
			RARE_COUNT,
		);
		const newestPage = await api.listThreads(run.inboxId);
		expect(newestPage.filter((t) => t.category === "personal")).toHaveLength(0);

		const context = await browser.newContext({
			storageState: run.storageState,
			baseURL: baseUrl,
			viewport: DESKTOP,
		});
		const page = await context.newPage();

		try {
			await page.goto(`/mail/${run.inboxId}`);
			await expect(row(page).first()).toBeVisible({ timeout: 30_000 });

			await page.getByRole("button", { name: "Expand filters" }).click();

			// Unclassified is a category of its own and is offered like any other
			// (#45, design D6/D21) — held out of the chip row until the predicate
			// became a server-side `where`.
			await expect(
				page.getByRole("button", { name: "Unclassified", exact: true }),
			).toBeVisible();

			await selectCategory(page, "Personal");

			for (const subject of rareSubjects) {
				await expect(row(page).filter({ hasText: subject })).toHaveCount(1, {
					timeout: 30_000,
				});
			}
			await expect(row(page)).toHaveCount(RARE_COUNT);

			// A category the mailbox holds none of is an empty list that says how
			// much was read, not a list that quietly shows something else.
			await selectCategory(page, "Social");
			await expect(page.getByText("No Social mail in Inbox")).toBeVisible({
				timeout: 30_000,
			});
			await expect(
				page.getByText("Every message in this folder was checked."),
			).toBeVisible();
			await expect(row(page)).toHaveCount(0);
		} finally {
			await context.close();
		}
	});
});
