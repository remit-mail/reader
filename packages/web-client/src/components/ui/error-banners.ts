export type ErrorBannerSeverity = "error" | "warning" | "info";

export interface ErrorBannerEntry {
	id: string;
	severity: ErrorBannerSeverity;
	title: string;
	detail?: string;
	createdAt: number;
}

export interface PushErrorInput {
	severity?: ErrorBannerSeverity;
	title: string;
	detail?: string;
}

const MAX_BANNERS = 5;

export const formatErrorDetail = (error: unknown): string | undefined => {
	if (error === undefined || error === null) return undefined;
	if (error instanceof Error) return error.message || undefined;
	if (typeof error === "string") return error || undefined;
	if (
		typeof error === "object" &&
		"message" in error &&
		typeof (error as { message: unknown }).message === "string"
	) {
		const message = (error as { message: string }).message;
		return message || undefined;
	}
	return undefined;
};

/**
 * Detect a "describeMessage hit a deleted/missing row" error.
 *
 * Soft-deleted ThreadMessage rows used to leak into the inbox list (#212);
 * clicking one fired `describeMessage` against an already-hard-deleted
 * Message and the backend's `NotFoundError` ("Message not found: <id>")
 * surfaced verbatim. We now filter those rows server-side, but the UI still
 * needs a graceful empty state when the cache is mid-refresh or the row
 * was just deleted in another tab.
 *
 * The backend serializes 404s as `{ message: "Message not found: <id>" }`
 * (see `packages/remit-backend/src/error.ts`). The hey-api fetch client
 * throws the parsed JSON body as the error, so we match by message prefix.
 */
export const isMessageNotFoundError = (error: unknown): boolean => {
	const detail = formatErrorDetail(error);
	if (!detail) return false;
	return detail.startsWith("Message not found");
};

const sameInput = (
	entry: ErrorBannerEntry,
	input: PushErrorInput,
	severity: ErrorBannerSeverity,
): boolean =>
	entry.severity === severity &&
	entry.title === input.title &&
	entry.detail === input.detail;

export const appendBanner = (
	current: ErrorBannerEntry[],
	entry: ErrorBannerEntry,
): ErrorBannerEntry[] => {
	const filtered = current.filter(
		(existing) =>
			!sameInput(
				existing,
				{ title: entry.title, detail: entry.detail, severity: entry.severity },
				entry.severity,
			),
	);
	const next = [...filtered, entry];
	if (next.length <= MAX_BANNERS) return next;
	return next.slice(next.length - MAX_BANNERS);
};

export const dismissBanner = (
	current: ErrorBannerEntry[],
	id: string,
): ErrorBannerEntry[] => current.filter((entry) => entry.id !== id);

export const buildEntry = (
	input: PushErrorInput,
	id: string,
	now: number,
): ErrorBannerEntry => ({
	id,
	severity: input.severity ?? "error",
	title: input.title,
	detail: input.detail,
	createdAt: now,
});
