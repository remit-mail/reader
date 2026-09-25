import { Select } from "@remit/ui";
import { UNZONED_CALENDAR } from "@/hooks/calendar";

/**
 * The zone a calendar's floating times are read in. The empty choice is how
 * the API spells "no zone", which reads as UTC — there is no IANA name for UTC
 * the server accepts, so it is offered as its own option rather than as a zone.
 */
export interface TimeZoneSelectProps {
	id: string;
	value: string;
	disabled?: boolean;
	onChange: (timeZone: string) => void;
}

const ZONES = Intl.supportedValuesOf("timeZone");

export function TimeZoneSelect({
	id,
	value,
	disabled,
	onChange,
}: TimeZoneSelectProps) {
	const zones =
		value === UNZONED_CALENDAR || ZONES.includes(value)
			? ZONES
			: [value, ...ZONES];
	return (
		<Select
			id={id}
			value={value}
			disabled={disabled}
			onChange={(event) => onChange(event.target.value)}
		>
			<option value={UNZONED_CALENDAR}>None (read as UTC)</option>
			{zones.map((zone) => (
				<option key={zone} value={zone}>
					{zone}
				</option>
			))}
		</Select>
	);
}
