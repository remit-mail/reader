import type { ThreadMessageItem } from "@remit/data-ports";

/**
 * The measured category shape of the owner's INBOX, shared by the category
 * suites (#304).
 *
 * It lives in one module because the shape is the load-bearing part of the
 * regression: a filter resolved over the page the server returned is empty at
 * every page size precisely because the rare categories sit outside the newest
 * page. Two copies of those numbers can drift apart, and the one that drifts
 * stops being the argument.
 *
 * Measured on the live instance (docs/architecture/mail-list-boundary.md).
 */

export type Category =
	| "personal"
	| "marketing"
	| "automated"
	| "newsletter"
	| "transactional"
	| "social";

export type CategoryTotals = Record<Category, number>;

/** INBOX as measured: 14,187 non-deleted rows. */
export const LIVE_TOTALS: CategoryTotals = {
	personal: 4753,
	marketing: 3942,
	automated: 2680,
	newsletter: 2295,
	transactional: 429,
	social: 88,
};

/**
 * The same shape with the four common categories trimmed.
 *
 * The rare tail is untouched — `social` stays at its measured 88 — so every
 * assertion the suites make about a rare category holds identically. What
 * shrinks is the bulk that only exists to make the common categories common,
 * which no suite asserts on and which costs ~20s of seeding.
 */
export const TRIMMED_TOTALS: CategoryTotals = {
	personal: 700,
	marketing: 500,
	automated: 400,
	newsletter: 200,
	transactional: 130,
	social: 88,
};

/**
 * The newest 100 rows of that INBOX, as measured. Two of the 4,753 personal
 * messages and two of the 88 social ones are in it, which is why selecting
 * either chip over the newest page returns almost nothing.
 */
export const NEWEST_100: CategoryTotals = {
	automated: 77,
	newsletter: 14,
	marketing: 3,
	social: 2,
	transactional: 2,
	personal: 2,
};

export const BASE_DATE = 1_767_225_600_000;

export const totalRows = (totals: CategoryTotals): number =>
	Object.values(totals).reduce((sum, count) => sum + count, 0);

// mulberry32: a real 32-bit generator, so the stream is the one the shuffle
// claims. The interleaving is part of the fixture — a failure has to be
// reproducible — so this is seeded rather than Math.random.
const mulberry32 = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const shuffled = (values: Category[], seed: number): Category[] => {
	const random = mulberry32(seed);
	const out = [...values];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
};

const expand = (counts: Partial<CategoryTotals>): Category[] => {
	const out: Category[] = [];
	for (const [category, count] of Object.entries(counts) as Array<
		[Category, number]
	>) {
		for (let i = 0; i < count; i++) out.push(category);
	}
	return out;
};

type FixtureRow = Omit<ThreadMessageItem, "star"> & { star: "none" };

/**
 * One mailbox of thread-message rows in the given category distribution,
 * newest first, with the measured mix in the newest 100.
 *
 * Every seventh row repeats its predecessor's `sentDate`, so a keyset walk over
 * the fixture crosses tie groups instead of a strictly distinct sequence.
 */
export const categoryFixtureRows = (options: {
	totals: CategoryTotals;
	accountConfigId: string;
	mailboxId: string;
}): FixtureRow[] => {
	const { totals, accountConfigId, mailboxId } = options;
	const tail = Object.fromEntries(
		(Object.keys(totals) as Category[]).map((category) => [
			category,
			totals[category] - NEWEST_100[category],
		]),
	) as CategoryTotals;

	const byRecency = [
		...shuffled(expand(NEWEST_100), 11),
		...shuffled(expand(tail), 29),
	];

	return byRecency.map((category, index) => {
		const step = index - (index % 7 === 0 && index > 0 ? 1 : 0);
		const sentDate = BASE_DATE - step * 1000;
		return {
			threadMessageId: `tm-category-${index}`,
			accountConfigId,
			threadId: `t-category-${index}`,
			messageId: `m-category-${index}`,
			mailboxId,
			uid: index + 1,
			referenceOrder: 0,
			internalDate: sentDate,
			sentDate,
			isRead: false,
			hasAttachment: false,
			star: "none",
			hasStars: false,
			isDeleted: false,
			category,
			createdAt: 0,
			updatedAt: 0,
		};
	});
};
