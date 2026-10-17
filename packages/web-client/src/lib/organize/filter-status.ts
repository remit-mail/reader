import type { RemitImapFilterResponse } from "@remit/api-http-client/types.gen.ts";

export type FilterDisplayStatus = "Active" | "Expired" | "Disabled";

export type FilterDisabledReason = RemitImapFilterResponse["disabledReason"];

/**
 * The displayed Active/Expired status of a filter.
 *
 * RFC 034 Decision 1.2: `expiresAt` is the source of truth, `state` is only a
 * lazily-patched cache. A `Temporary` filter whose `expiresAt` is in the past
 * is Expired the instant that comparison is made, even if the server has not
 * yet patched `state` to `Expired`. So the client compares `expiresAt` against
 * `now` directly and also honors a `state` the server already flipped.
 *
 * An `Expired` filter is never hidden — it stays listed so the user can see
 * what it was and when it stopped (RFC 034 Decision 1.2, "stops on its own").
 */
export const filterDisplayStatus = (
	filter: Pick<RemitImapFilterResponse, "scope" | "expiresAt" | "state">,
	now: number,
): FilterDisplayStatus => {
	if (filter.state === "Expired") return "Expired";
	const running = filter.state === "Disabled" ? "Disabled" : "Active";
	if (filter.scope !== "Temporary") return running;
	if (!filter.expiresAt) return running;

	const expiresAtMs = Date.parse(filter.expiresAt);
	if (Number.isNaN(expiresAtMs)) return running;
	return expiresAtMs <= now ? "Expired" : running;
};

const DISABLED_REASON_COPY: Record<
	Exclude<FilterDisabledReason, "None">,
	string
> = {
	UserDisabled: "Turned off. Turn it on to run it on new mail again.",
	AwaitingFolder:
		"Off until its folder exists on the mail server. It turns on by itself once the folder is created.",
	FolderCreateFailed:
		"Off: the mail server refused to create its folder. Pick another folder in the rule, then turn it on.",
	FolderMissing:
		"Off: the folder it moves mail into no longer exists. Pick another folder in the rule, then turn it on.",
};

export const disabledReasonCopy = (
	filter: Pick<RemitImapFilterResponse, "disabledReason" | "actionMailboxId">,
): string | undefined => {
	if (filter.disabledReason === "None") return undefined;
	const folderless =
		filter.disabledReason === "AwaitingFolder" ||
		filter.disabledReason === "FolderCreateFailed";
	if (folderless && filter.actionMailboxId !== "None") {
		return DISABLED_REASON_COPY.UserDisabled;
	}
	return DISABLED_REASON_COPY[filter.disabledReason];
};

/**
 * Human-readable rendering of an expiry timestamp, e.g. "Jul 16, 2026".
 * Returns `undefined` for an absent or unparseable value so a standing filter
 * (no `expiresAt`) renders nothing.
 */
export const formatExpiresAt = (
	expiresAt: string | undefined,
): string | undefined => {
	if (!expiresAt) return undefined;
	const ms = Date.parse(expiresAt);
	if (Number.isNaN(ms)) return undefined;
	return new Date(ms).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
};

/**
 * Turn a plain picked calendar date (`YYYY-MM-DD`, from a native date input)
 * into an ISO 8601 timestamp with the local zone offset, at end of that day —
 * the filter is meant to stay active through the whole picked day (RFC 034
 * Decision 1.1, a zoned civil date). Returns `undefined` for empty input.
 */
export const pickedDateToExpiresAt = (
	pickedDate: string,
	referenceDate: Date = new Date(),
): string | undefined => {
	if (!pickedDate) return undefined;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pickedDate);
	if (!match) return undefined;

	const [, year, month, day] = match;
	const local = new Date(
		Number(year),
		Number(month) - 1,
		Number(day),
		23,
		59,
		59,
		0,
	);
	if (Number.isNaN(local.getTime())) return undefined;

	const offsetMinutes = -referenceDate.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMinutes);
	const offHours = String(Math.floor(abs / 60)).padStart(2, "0");
	const offMins = String(abs % 60).padStart(2, "0");

	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}` +
		`T${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}` +
		`${sign}${offHours}:${offMins}`
	);
};
