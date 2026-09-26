function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** `13:00` + 90 → `14:30`. Empty in, empty out. */
export function addMinutesToClock(clock: string, minutes: number): string {
	if (clock === "") return "";
	const [hours, mins] = clock.split(":").map(Number);
	const total = (hours * 60 + mins + minutes) % 1440;
	return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
