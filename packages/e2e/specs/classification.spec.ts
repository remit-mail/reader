/**
 * Regression cover for issue #45 — "classification barely (doesn't) seem to
 * work". Reported against real mail: only `personal` and `marketing` held
 * anything, one LinkedIn message sat in `marketing`, and hundreds of automated
 * notifications were filed as `personal`.
 *
 * This measures the whole path from outside: an RFC 5322 message on the IMAP
 * server, through metadata sync, body sync, the header classifier, and the
 * denormalized category the list API serves. A unit test over the rule table
 * cannot fail for the reasons this issue actually failed for — mail never
 * reaching the classifier, or a category never reaching the read path.
 */
import { waitFor } from "../src/api.js";
import { expect, test } from "../src/fixtures.js";

type Expectation = { subject: string; expectedCategory: string };

// The mail a header rule matches. The rest stays `uncategorized` until the
// category classifier answers (RFC 041), and this deployment runs none.
const ruleMatched = (expectations: Expectation[]): Set<string> =>
	new Set(
		expectations
			.filter((e) => e.expectedCategory !== "uncategorized")
			.map((e) => e.subject),
	);

const headerClassified = (
	items: { subject?: string; category?: string }[],
	matched: Set<string>,
): boolean => {
	const seeded = items.filter((t) => matched.has(t.subject ?? ""));
	return (
		seeded.length === matched.size &&
		seeded.every((t) => t.category && t.category !== "uncategorized")
	);
};

test.describe("Classification", () => {
	test("every seeded message a header rule matches is classified", async ({
		api,
		run,
	}) => {
		// The failure the issue actually describes: mail syncs, the body lands,
		// and the category is never written. Read through the API it presents as
		// a full `personal` inbox, so this asserts the absence of the silent
		// state rather than any particular bucket.
		const subjects = ruleMatched(run.classificationExpectations);

		const threads = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => headerClassified(items, subjects),
			{
				timeoutMs: 90_000,
				what: "every classification fixture to be body-classified",
			},
		);

		const seeded = threads.filter((t) => subjects.has(t.subject ?? ""));
		expect(seeded).toHaveLength(subjects.size);
		for (const thread of seeded) {
			expect(
				thread.category,
				`"${thread.subject}" was never classified`,
			).not.toBe("uncategorized");
		}
	});

	test("each seeded message lands in the category its headers call for", async ({
		api,
		run,
	}) => {
		const expected = new Map(
			run.classificationExpectations.map((e) => [
				e.subject,
				e.expectedCategory,
			]),
		);

		const subjects = ruleMatched(run.classificationExpectations);

		const threads = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => headerClassified(items, subjects),
			{
				timeoutMs: 90_000,
				what: "every classification fixture to be body-classified",
			},
		);

		const actual = new Map(
			threads
				.filter((t) => expected.has(t.subject ?? ""))
				.map((t) => [t.subject as string, t.category]),
		);

		// Compared as whole maps so a failure names every miscategorised subject
		// at once, not just the first.
		expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
	});

	test("the buckets the issue reported as empty are populated", async ({
		api,
		run,
	}) => {
		// The headline symptom was distribution, not any single message: rules
		// that matched too early collapsed newsletter, social and transactional
		// into other buckets, leaving those views empty.
		const subjects = ruleMatched(run.classificationExpectations);

		const threads = await waitFor(
			() => api.listThreads(run.inboxId),
			(items) => headerClassified(items, subjects),
			{
				timeoutMs: 90_000,
				what: "every classification fixture to be body-classified",
			},
		);

		const found = new Set(
			threads
				.filter((t) => subjects.has(t.subject ?? ""))
				.map((t) => t.category),
		);

		for (const category of [
			"newsletter",
			"marketing",
			"social",
			"transactional",
			"automated",
		]) {
			expect(found, `no message landed in "${category}"`).toContain(category);
		}
	});
});
