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
