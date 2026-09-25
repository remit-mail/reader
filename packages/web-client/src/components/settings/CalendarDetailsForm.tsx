/**
 * Settings › Calendars: one calendar's name and zone, and deleting it.
 *
 * Presentational. The draft starts from what the server holds and the parent
 * remounts it when that changes, so a saved rename reads back from the listing
 * rather than from what was typed. A delete always asks first: the calendar
 * goes with every event in it, and nothing on this page can tell an empty one
 * from a full one without reading all of its time.
 */
import { Banner, Button, ConfirmDialog, Input } from "@remit/ui";
import { Save, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { TimeZoneSelect } from "@/components/settings/TimeZoneSelect";
import { deleteCalendarConfirmCopy } from "@/lib/calendar-collection-copy";

export interface CalendarDetails {
	displayName: string;
	timezone: string;
}

export interface CalendarDetailsFormProps {
	/** What the server holds now. */
	calendarName: string;
	timezone: string;
	isBusy: boolean;
	/** The server's words for the last write it turned down; empty when none. */
	problem: string;
	onSave: (details: CalendarDetails) => void;
	onDelete: () => void;
}

export function CalendarDetailsForm({
	calendarName,
	timezone,
	isBusy,
	problem,
	onSave,
	onDelete,
}: CalendarDetailsFormProps) {
	const [displayName, setDisplayName] = useState(calendarName);
	const [zone, setZone] = useState(timezone);
	const [confirming, setConfirming] = useState(false);
	const nameId = useId();
	const zoneId = useId();

	const trimmed = displayName.trim();
	const changed = trimmed !== calendarName || zone !== timezone;
	const copy = deleteCalendarConfirmCopy(calendarName);

	return (
		<>
			<form
				className="space-y-3"
				onSubmit={(event) => {
					event.preventDefault();
					if (!changed || trimmed === "") return;
					onSave({ displayName: trimmed, timezone: zone });
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
							htmlFor={zoneId}
							className="text-xs font-medium text-fg-muted"
						>
							Time zone
						</label>
						<TimeZoneSelect
							id={zoneId}
							value={zone}
							disabled={isBusy}
							onChange={setZone}
						/>
					</div>
				</div>

				{problem !== "" && (
					<Banner tone="danger" variant="soft">
						<p className="font-medium">{calendarName} was not changed.</p>
						<p className="mt-0.5 break-words">{problem}</p>
					</Banner>
				)}

				<div className="flex flex-wrap gap-2">
					<Button
						type="submit"
						variant="secondary"
						size="sm"
						disabled={isBusy || !changed || trimmed === ""}
						icon={<Save className="size-3.5" />}
					>
						Save changes
					</Button>
					<Button
						type="button"
						variant="danger"
						size="sm"
						disabled={isBusy}
						icon={<Trash2 className="size-3.5" />}
						onClick={() => setConfirming(true)}
					>
						Delete calendar
					</Button>
				</div>
			</form>

			<ConfirmDialog
				isOpen={confirming}
				title={copy.title}
				description={copy.description}
				confirmLabel="Delete calendar"
				destructive
				onConfirm={() => {
					setConfirming(false);
					onDelete();
				}}
				onCancel={() => setConfirming(false)}
			/>
		</>
	);
}
