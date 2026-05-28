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

/**
 * Format a number as compact (1.2K, 3.4M, etc.)
 */
export const formatCompactNumber = (value: number): string => {
	return formatNumber(value, { notation: "compact", compactDisplay: "short" });
};

/**
 * Format a date according to user's locale.
 */
export const formatDate = (
	date: Date | string | number,
	options?: Intl.DateTimeFormatOptions,
): string => {
	const d =
		typeof date === "string" || typeof date === "number"
			? new Date(date)
			: date;
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
	const d =
		typeof date === "string" || typeof date === "number"
			? new Date(date)
			: date;
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
	const d =
		typeof date === "string" || typeof date === "number"
			? new Date(date)
			: date;
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
 * Format file size in human-readable format.
 */
export const formatFileSize = (bytes: number): string => {
	const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
	let unitIndex = 0;
	let size = bytes;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return formatNumber(size, {
		style: "unit",
		unit: units[unitIndex],
		unitDisplay: "short",
		maximumFractionDigits: 1,
	});
};

/**
 * Format a list of items (e.g., "Alice, Bob, and Carol").
 */
export const formatList = (
	items: string[],
	type: "conjunction" | "disjunction" = "conjunction",
): string => {
	return new Intl.ListFormat(getLocale(), {
		style: "long",
		type,
	}).format(items);
};

/**
 * Confirmation title for the move-to-Trash delete flow. Reflects that delete
 * moves messages to Trash (not a permanent delete) and pluralizes on count.
 */
export const formatDeleteToTrashTitle = (count: number): string =>
	count === 1 ? "Move 1 message to Trash?" : `Move ${count} messages to Trash?`;
