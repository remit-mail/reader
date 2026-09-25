/**
 * Settings › Calendars: where a subscribed calendar comes from, when it was
 * last read, why it was not, and the switch that stops its refresh
 * (issue #1261).
 *
 * The address itself is not drawn. For a Google feed it is the whole
 * credential, so only its host is named.
 */
import { Badge, Banner, Button } from "@remit/ui";
import { Pause, Play } from "lucide-react";
import { formatErrorMessage } from "@/components/ui/ErrorState";
import { formatDatePreset } from "@/lib/format";

export interface CalendarSubscriptionStatusProps {
	calendarName: string;
	subscriptionUrl: string;
	enabled: boolean;
	fetchedAt: number;
	error: string;
	isBusy: boolean;
	/** A pause or resume the server turned down. */
	actionError: unknown;
	onSetEnabled: (enabled: boolean) => void;
}

export const subscriptionHostOf = (subscriptionUrl: string): string =>
	URL.canParse(subscriptionUrl)
		? new URL(subscriptionUrl).host
		: "an iCalendar feed";

export function CalendarSubscriptionStatus({
	calendarName,
	subscriptionUrl,
	enabled,
	fetchedAt,
	error,
	isBusy,
	actionError,
	onSetEnabled,
}: CalendarSubscriptionStatusProps) {
	return (
		<div className="mb-4 space-y-2 border-b border-line pb-4">
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone={enabled ? "positive" : "neutral"}>
					{enabled ? "subscribed" : "paused"}
				</Badge>
				<span className="text-xs text-fg-muted">
					Read-only, from {subscriptionHostOf(subscriptionUrl)}
					{fetchedAt > 0
						? `. Last updated ${formatDatePreset(fetchedAt, "medium")}`
						: ""}
				</span>
			</div>
			{error !== "" && (
				<Banner tone="warning" variant="soft">
					<p className="font-medium">{calendarName} was not refreshed.</p>
					<p className="mt-0.5 break-words">{error}</p>
				</Banner>
			)}
			<p className="text-sm text-fg-muted">
				{enabled
					? "Events are read from the feed on a schedule and cannot be edited here."
					: "Updates are paused. The events already here stay until you resume or remove the calendar."}
			</p>
			<Button
				variant="secondary"
				size="sm"
				disabled={isBusy}
				icon={
					enabled ? (
						<Pause className="size-3.5" />
					) : (
						<Play className="size-3.5" />
					)
				}
				onClick={() => onSetEnabled(!enabled)}
			>
				{enabled ? "Pause updates" : "Resume updates"}
			</Button>
			{actionError !== undefined && actionError !== null && (
				<Banner tone="danger" variant="soft">
					<p className="font-medium">
						Updates for {calendarName} were not changed.
					</p>
					<p className="mt-0.5 break-words">
						{formatErrorMessage(actionError)}
					</p>
				</Banner>
			)}
		</div>
	);
}
