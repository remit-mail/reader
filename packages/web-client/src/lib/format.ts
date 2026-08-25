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
 * What the caller knows about the account's Trash. Two folder names, never one:
 * the folder reader guessed and the folder that vanished are different facts.
 * Both optional — a caller holding no open mailbox passes neither, and the copy
 * drops the name clause rather than inventing one.
 */
export interface DeleteConfirmationContext {
	/** The folder reader files this account's deletes in. */
	trashFolderLabel?: string;
	/** The folder the user appointed, now gone from the mail server. */
	staleFolderLabel?: string;
	/** That folder is a name match nobody ever confirmed. */
	trashIsUnconfirmed?: boolean;
}

/**
 * What a delete will actually do to the selected mail.
 *
 * `unknown` is the state before the account's Trash appointment has resolved — a
 * real state on a cold open, and the one the copy must not guess at, because
 * guessing "move to Trash" over an expunge is the dishonesty this whole flow
 * exists to remove.
 *
 * `noTrash` is a resolved answer of "none": the account appoints no Trash, so
 * the server refuses the delete outright (#846) rather than moving anything.
 * It is a different fact from "this row is not in Trash" and must never share
 * an outcome with it — one promises a restore that can happen, the other a
 * delete that will not.
 *
 * `unavailable` is the appointment failing to resolve at all. A read that
 * cannot answer is not an answer: treating an errored `/config` as "no Trash
 * here" reinstates the same lie on the failure path, where an expired session
 * would collect "Move to Trash?" over an expunge. The delete is refused and the
 * failure is stated instead.
 *
 * `staleTrash` is a resolved answer of "the folder you chose is gone" (#887).
 * It is a repair rather than a first choice, and the copy says so, which a
 * single `noTrash` member cannot — this function only ever sees the member.
 *
 * `unconfirmed` is a folder reader matched by name that nobody ever confirmed.
 * Empty Trash refuses on it for the whole folder (D4); `deleteOutcomeFor`
 * produces it too, for the narrower case of a row that is already inside that
 * folder — deleting it expunges on the same name guess, and the guess is never
 * enough to destroy mail (#876). Both surfaces derive it from the server's own
 * 409, and the branch lives here so they word it identically.
 */
export type DeleteOutcome =
	| "trash"
	| "permanent"
	| "noTrash"
	| "staleTrash"
	| "unconfirmed"
	| "unknown"
	| "unavailable";

/** Where an account's Trash answer came from (`FolderAppointmentSource`). */
export type TrashSource =
	| "Appointed"
	| "Flagged"
	| "Reserved"
	| "Proposed"
	| "Stale"
	| "None";

/** One account's Trash, as `/config` resolved it. */
export interface TrashResolution {
	mailboxId: string | undefined;
	source: TrashSource;
	/** `Stale` only: the path the folder the user chose last had. */
	staleFolderPath?: string;
}

/** A row about to be deleted, and the account whose Trash decides its fate. */
export interface DeleteTarget {
	accountId: string | undefined;
	mailboxId: string;
}

export interface DeleteOutcomeInput {
	targets: readonly DeleteTarget[];
	/**
	 * Each account's Trash and where that answer came from. A key present is an
	 * answer, `source` and all — a key absent is an account nothing is known
	 * about yet.
	 */
	trashByAccount: ReadonlyMap<string, TrashResolution>;
	/**
	 * The appointments have actually arrived. Never `!isLoading`: React Query
	 * v5 leaves a paused offline query pending-but-not-fetching, which reads as
	 * loaded while `data` is still undefined.
	 */
	hasAppointments: boolean;
	/** The read for them failed. */
	isError: boolean;
}

/**
 * The outcome of deleting `targets`.
 *
 * One row bound for an expunge makes the whole delete unrecoverable, so a mixed
 * set is permanent: the wording may overstate what is destroyed, never what is
 * kept. One row on an account with no Trash refuses the whole call, so that
 * outranks both. An expunge on a Trash nobody confirmed outranks a plain
 * expunge in turn — the server refuses it (#876), so the dialog asks for the
 * same confirmation up front rather than offering a confirm that 409s. Pure,
 * so every branch — the failure ones above all — is testable without a DOM.
 */
export const deleteOutcomeFor = ({
	targets,
	trashByAccount,
	hasAppointments,
	isError,
}: DeleteOutcomeInput): DeleteOutcome => {
	if (isError) return "unavailable";
	if (!hasAppointments) return "unknown";
	if (targets.length === 0) return "unknown";

	let expunges = false;
	let expungesUnconfirmed = false;
	for (const target of targets) {
		if (target.accountId === undefined) return "unknown";
		const trash = trashByAccount.get(target.accountId);
		if (trash === undefined) return "unknown";
		if (trash.source === "Stale") return "staleTrash";
		if (trash.mailboxId === undefined) return "noTrash";
		if (trash.mailboxId === target.mailboxId) {
			expunges = true;
			if (trash.source === "Proposed") expungesUnconfirmed = true;
		}
	}
	if (expungesUnconfirmed) return "unconfirmed";
	return expunges ? "permanent" : "trash";
};

/**
 * The confirmation for a delete, worded for what the delete actually does.
 * Deleting mail that already sits in Trash expunges it on the server and
 * nothing survives that, so it is asked as a permanent delete — a dialog that
 * says "Move to Trash" over an expunge collects an answer to a question the
 * user was never asked.
 *
 * `noTrash`, `staleTrash`, `unconfirmed` and `unavailable` are not
 * confirmations at all but refusals: nothing is deleted, and the label names
 * the way out rather than the delete. The first three are answered in place by
 * the appointment prompt — a link to Settings as the only remedy leaves the
 * user to reassemble what they were doing. `unavailable` still routes to
 * re-authentication, because an account read that fails is a session that ended
 * under the reader far more often than it is anything else.
 */
export const deleteConfirmationCopy = (
	count: number,
	outcome: DeleteOutcome,
	context: DeleteConfirmationContext = {},
): DeleteConfirmationCopy => {
	const quantity = count === 1 ? "1" : formatNumber(count);
	const noun = count === 1 ? "message" : "messages";
	const { trashFolderLabel, staleFolderLabel, trashIsUnconfirmed } = context;

	if (outcome === "noTrash") {
		return {
			title: `Can't delete ${quantity} ${noun} yet`,
			description:
				"No folder on this account is set as Trash, so there is nowhere to move the mail. Nothing has been deleted.",
			confirmLabel: "Pick a Trash folder",
		};
	}
	if (outcome === "staleTrash") {
		return {
			title: `Can't delete ${quantity} ${noun} yet`,
			description: staleFolderLabel
				? `The folder you set as this account's Trash — ${staleFolderLabel} — is gone from the mail server. Nothing has been deleted.`
				: "The folder you set as this account's Trash is gone from the mail server. Nothing has been deleted.",
			confirmLabel: "Pick another folder",
		};
	}
	if (outcome === "unconfirmed") {
		const folderClause = trashFolderLabel
			? `reader files this account's deleted mail in ${trashFolderLabel} because of its name — nobody confirmed it.`
			: "reader files this account's deleted mail in a folder it matched by name — nobody confirmed it.";
		// count === 0: Empty Trash, acting on everything the folder holds. A
		// positive count: a delete whose rows already sit in that folder, so
		// this expunges them specifically, not the folder's whole contents.
		return {
			title: "Confirm this account's Trash folder",
			description:
				count > 0
					? `${folderClause} Deleting ${quantity} ${noun} there erases them from the mail server, and that cannot be restored. Nothing has been deleted.`
					: `${folderClause} Emptying a folder erases everything in it from the mail server, and that cannot be restored. Nothing has been emptied.`,
			confirmLabel: "Confirm the folder",
		};
	}
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
		// D4a: the expunge still goes through on a Trash nobody confirmed — the
		// user asked for these specific rows — but they are told which folder
		// reader treats as Trash, and that nobody chose it, before it happens.
		if (trashIsUnconfirmed) {
			return {
				title: `Permanently delete ${quantity} ${noun}?`,
				description: trashFolderLabel
					? `They are in ${trashFolderLabel}, which reader treats as this account's Trash because of its name — nobody confirmed it. They are erased from the mail server and cannot be restored.`
					: "They are in a folder reader treats as this account's Trash because of its name — nobody confirmed it. They are erased from the mail server and cannot be restored.",
				confirmLabel: "Delete permanently",
			};
		}
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
