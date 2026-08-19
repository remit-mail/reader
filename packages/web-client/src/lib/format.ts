/**
 * Get the user's preferred locale from browser settings.
 * Falls back to 'en-US' if unavailable.
 */
const getLocale = (): string => {
	if (typeof navigator !== "undefined") {
		return navigator.language || navigator.languages?.[0] || "en-US";
	}
	return "en-US";
};

/**
 * Format a number according to user's locale.
 */
export const formatNumber = (
	value: number,
	options?: Intl.NumberFormatOptions,
): string => {
	return new Intl.NumberFormat(getLocale(), options).format(value);
};

const EPOCH_STRING = /^-?\d+$/;

/**
 * Coerce any accepted date input into a Date. An all-digit string is treated as
 * an epoch (the Postgres read path serializes int64 columns as numeric strings);
 * any other string goes through the normal Date parser.
 */
export const toDate = (value: Date | string | number): Date => {
	if (value instanceof Date) return value;
	if (typeof value === "number") return new Date(value);
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (EPOCH_STRING.test(trimmed)) return new Date(Number(trimmed));
		return new Date(trimmed);
	}
	return new Date(Number.NaN);
};

const isValidDate = (date: Date): boolean => Number.isFinite(date.getTime());

/**
 * Format a date according to user's locale. A missing or unparseable date
 * renders as an empty string instead of throwing — display must never crash the
 * view over one bad row.
 */
export const formatDate = (
	date: Date | string | number,
	options?: Intl.DateTimeFormatOptions,
): string => {
	const d = toDate(date);
	if (!isValidDate(d)) return "";
	return new Intl.DateTimeFormat(getLocale(), options).format(d);
};

/**
 * Format date with common presets.
 */
export const formatDatePreset = (
	date: Date | string | number,
	preset: "short" | "medium" | "long" | "full" | "time" | "datetime",
): string => {
	const presets: Record<typeof preset, Intl.DateTimeFormatOptions> = {
		short: { month: "short", day: "numeric" },
		medium: { month: "short", day: "numeric", year: "numeric" },
		long: { month: "long", day: "numeric", year: "numeric" },
		full: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
		time: { hour: "numeric", minute: "numeric" },
		datetime: {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
		},
	};
	return formatDate(date, presets[preset]);
};

/**
 * Format relative time (e.g., "2 hours ago", "in 3 days").
 */
export const formatRelativeTime = (date: Date | string | number): string => {
	const d = toDate(date);
	if (!isValidDate(d)) return "";
	const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" });
	const now = Date.now();
	const diff = d.getTime() - now;
	const diffSeconds = Math.round(diff / 1000);
	const diffMinutes = Math.round(diff / (1000 * 60));
	const diffHours = Math.round(diff / (1000 * 60 * 60));
	const diffDays = Math.round(diff / (1000 * 60 * 60 * 24));
	const diffWeeks = Math.round(diff / (1000 * 60 * 60 * 24 * 7));

	if (Math.abs(diffSeconds) < 60) {
		return rtf.format(diffSeconds, "second");
	}
	if (Math.abs(diffMinutes) < 60) {
		return rtf.format(diffMinutes, "minute");
	}
	if (Math.abs(diffHours) < 24) {
		return rtf.format(diffHours, "hour");
	}
	if (Math.abs(diffDays) < 7) {
		return rtf.format(diffDays, "day");
	}
	if (Math.abs(diffWeeks) < 4) {
		return rtf.format(diffWeeks, "week");
	}

	return formatDatePreset(d, "medium");
};

/**
 * Format email date intelligently based on age.
 * - Today: "10:42" (time only)
 * - Yesterday: "Yesterday"
 * - This week: "Tuesday" (day name)
 * - Older: "Jan 17" (or "Jan 17, 2023" if different year)
 */
export const formatEmailDate = (date: Date | string | number): string => {
	const d = toDate(date);
	if (!isValidDate(d)) return "";
	const now = new Date();

	const isToday = d.toDateString() === now.toDateString();

	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	const isYesterday = d.toDateString() === yesterday.toDateString();

	const sixDaysAgo = new Date(now);
	sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
	const isThisWeek = d >= sixDaysAgo && d < now;

	const isThisYear = d.getFullYear() === now.getFullYear();

	if (isToday) {
		return formatDate(d, { hour: "numeric", minute: "numeric" });
	}
	if (isYesterday) {
		return "Yesterday";
	}
	if (isThisWeek) {
		return formatDate(d, { weekday: "long" });
	}
	if (isThisYear) {
		return formatDate(d, { month: "short", day: "numeric" });
	}
	return formatDate(d, { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Confirmation title for the move-to-Trash delete flow. Reflects that delete
 * moves messages to Trash (not a permanent delete) and pluralizes on count.
 * The count is always a concrete list of ids — every predicate delete ends on
 * the wizard's review screen instead, which states what the predicate covers.
 */
export const formatDeleteToTrashTitle = (count: number): string => {
	const quantity = count === 1 ? "1" : formatNumber(count);
	const noun = count === 1 ? "message" : "messages";
	return `Move ${quantity} ${noun} to Trash?`;
};

export interface DeleteConfirmationCopy {
	title: string;
	description: string;
	confirmLabel: string;
}

/**
 * What a delete will actually do to the selected mail.
 *
 * `unknown` is the state before the account's Trash appointment has resolved —
 * a real state on a cold open, and the one the copy must not guess at, because
 * guessing "move to Trash" over an expunge is the dishonesty this whole flow
 * exists to remove.
 *
 * `unavailable` is that appointment failing to resolve at all. A read that
 * cannot answer is not an answer: treating an errored `/config` as "no Trash
 * here" reinstates the same lie on the failure path, where an expired session
 * would collect "Move to Trash?" over an expunge. The delete is refused and the
 * failure is stated instead.
 */
export type DeleteOutcome = "trash" | "permanent" | "unknown" | "unavailable";

export interface DeleteOutcomeInput {
	/** The folder each row about to be deleted is filed in. */
	mailboxIds: readonly string[];
	/** Every mailbox appointed to Trash, across the accounts in play. */
	trashMailboxIds: ReadonlySet<string>;
	/** The appointments have not arrived yet. */
	isLoading: boolean;
	/** The read for them failed. */
	isError: boolean;
}

/**
 * The outcome of deleting the rows filed in `mailboxIds`.
 *
 * One row bound for an expunge makes the whole delete unrecoverable, so a mixed
 * set is permanent: the wording may overstate what is destroyed, never what is
 * kept. Pure, so every branch — the failure one above all — is testable without
 * a DOM.
 */
export const deleteOutcomeFor = ({
	mailboxIds,
	trashMailboxIds,
	isLoading,
	isError,
}: DeleteOutcomeInput): DeleteOutcome => {
	if (isError) return "unavailable";
	if (isLoading) return "unknown";
	if (mailboxIds.length === 0) return "unknown";
	if (mailboxIds.some((id) => trashMailboxIds.has(id))) return "permanent";
	return "trash";
};

/**
 * The confirmation for a delete, worded for what the delete actually does.
 * Deleting mail that already sits in Trash expunges it on the server and
 * nothing survives that, so it is asked as a permanent delete — a dialog that
 * says "Move to Trash" over an expunge collects an answer to a question the
 * user was never asked.
 *
 * `unavailable` is not a confirmation at all but a refusal: nothing is deleted,
 * and the label names the way back rather than the delete. The caller wires it
 * to re-authentication, because a failed account read is a session that ended
 * under the reader far more often than it is anything else.
 */
export const deleteConfirmationCopy = (
	count: number,
	outcome: DeleteOutcome,
): DeleteConfirmationCopy => {
	const quantity = count === 1 ? "1" : formatNumber(count);
	const noun = count === 1 ? "message" : "messages";

	if (outcome === "unavailable") {
		return {
			title: `Can't delete ${quantity} ${noun}`,
			description:
				"reader couldn't read this account's folder settings, so it can't say whether this would move the mail to Trash or erase it. Nothing has been deleted.",
			confirmLabel: "Sign in again",
		};
	}
	if (outcome === "unknown") {
		return {
			title: `Delete ${quantity} ${noun}?`,
			description: "Checking where this account files deleted mail…",
			confirmLabel: "Delete",
		};
	}
	if (outcome === "permanent") {
		return {
			title: `Permanently delete ${quantity} ${noun}?`,
			description:
				"They are erased from the mail server and cannot be restored.",
			confirmLabel: "Delete permanently",
		};
	}
	return {
		title: formatDeleteToTrashTitle(count),
		description: "You can restore them from Trash later.",
		confirmLabel: "Move to Trash",
	};
};
