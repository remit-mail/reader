/**
 * Settings › Calendars: adding a calendar.
 *
 * The address is the collection's identity and the path a CalDAV client
 * bookmarks, so it is asked for rather than hidden. It follows the name until
 * the reader edits it, and the server decides whether it is free — a taken one
 * comes back in the server's words where the button is.
 */
import {
	Banner,
	Button,
	Card,
	CardBody,
	CardHeader,
	CardTitle,
	Input,
} from "@remit/ui";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import type { CalendarDetails } from "@/components/settings/CalendarDetailsForm";
import { TimeZoneSelect } from "@/components/settings/TimeZoneSelect";
import { UNZONED_CALENDAR } from "@/hooks/calendar";
import { calendarUrlSegmentFor } from "@/lib/calendar-collection-copy";

export interface NewCalendar extends CalendarDetails {
	urlSegment: string;
}

export interface CalendarCreateCardProps {
	isBusy: boolean;
	/** The server's words for the last create it turned down; empty when none. */
	problem: string;
	/** Resolves true once the server has the calendar, so the form can clear. */
	onCreate: (calendar: NewCalendar) => Promise<boolean>;
}

export function CalendarCreateCard({
	isBusy,
	problem,
	onCreate,
}: CalendarCreateCardProps) {
	const [displayName, setDisplayName] = useState("");
	const [typedSegment, setTypedSegment] = useState<string | undefined>(
		undefined,
	);
	const [timezone, setTimezone] = useState(UNZONED_CALENDAR);
	const titleId = useId();
	const nameId = useId();
	const segmentId = useId();
	const zoneId = useId();

	const urlSegment = typedSegment ?? calendarUrlSegmentFor(displayName);
	const ready = displayName.trim() !== "" && urlSegment.trim() !== "";

	return (
		<Card className="max-w-xl" role="region" aria-labelledby={titleId}>
			<CardHeader>
				<CardTitle id={titleId}>New calendar</CardTitle>
			</CardHeader>
			<CardBody>
				<form
					className="space-y-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (!ready) return;
						void onCreate({
							displayName: displayName.trim(),
							urlSegment: urlSegment.trim(),
							timezone,
						}).then((created) => {
							if (!created) return;
							setDisplayName("");
							setTypedSegment(undefined);
							setTimezone(UNZONED_CALENDAR);
						});
					}}
				>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1">
							<label
								htmlFor={nameId}
								className="text-xs font-medium text-fg-muted"
							>
								Name
							</label>
							<Input
								id={nameId}
								value={displayName}
								maxLength={140}
								disabled={isBusy}
								onChange={(event) => setDisplayName(event.target.value)}
							/>
						</div>
						<div className="space-y-1">
							<label
								htmlFor={segmentId}
								className="text-xs font-medium text-fg-muted"
							>
								Address
							</label>
							<Input
								id={segmentId}
								value={urlSegment}
								maxLength={64}
								disabled={isBusy}
								onChange={(event) => setTypedSegment(event.target.value)}
							/>
						</div>
						<div className="space-y-1 sm:col-span-2">
							<label
								htmlFor={zoneId}
								className="text-xs font-medium text-fg-muted"
							>
								Time zone
							</label>
							<TimeZoneSelect
								id={zoneId}
								value={timezone}
								disabled={isBusy}
								onChange={setTimezone}
							/>
						</div>
					</div>
					<p className="text-xs text-fg-muted">
						The address names the calendar for CalDAV clients and cannot be
						changed later. The name and zone can.
					</p>

					{problem !== "" && (
						<Banner tone="danger" variant="soft">
							<p className="font-medium">The calendar was not added.</p>
							<p className="mt-0.5 break-words">{problem}</p>
						</Banner>
					)}

					<Button
						type="submit"
						variant="primary"
						size="sm"
						disabled={isBusy || !ready}
						icon={<Plus className="size-3.5" />}
					>
						{isBusy ? "Adding…" : "Add calendar"}
					</Button>
				</form>
			</CardBody>
		</Card>
	);
}
