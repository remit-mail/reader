import { SettingsShell } from "@remit/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarFeedPanel } from "@/components/settings/CalendarFeedPanel";
import { useCalendars } from "@/hooks/calendar/useCalendars";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/calendars")({
	component: CalendarsSettings,
});

const calendarsHelp = (
	<div className="space-y-3">
		<p>
			A subscription address lets Apple Calendar, Google Calendar, Outlook and
			Thunderbird show a calendar from here, read-only and kept up to date.
		</p>
		<p>
			Those clients never sign in, so the address itself is the credential.
			Anyone who has it can read the calendar; nobody who has it can change
			anything.
		</p>
		<p>
			Only a hash of the address is stored, so it is shown once and cannot be
			looked up later. Replacing it breaks every subscription built on the old
			one, which is how a shared address is taken back.
		</p>
	</div>
);

function CalendarsSettings() {
	const navigate = useNavigate();
	const [helpOpen, setHelpOpen] = useState(true);
	const { calendars, isLoading } = useCalendars();

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="calendars"
			title="Calendars"
			description="Share a calendar with any client that can subscribe to a URL."
			help={calendarsHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((open) => !open)}
			onSelect={(id) => {
				const path = SETTINGS_ID_TO_PATH[id];
				if (path) void navigate({ to: path });
			}}
			onBackToMail={() => void navigate({ to: "/mail" })}
		>
			{isLoading ? (
				// biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label on a loading skeleton is what assistive tech has to go on
				<div
					className="h-24 animate-pulse rounded-sm border border-line bg-surface"
					aria-busy="true"
					aria-label="Loading calendars"
				/>
			) : calendars.length === 0 ? (
				<p className="py-12 text-sm text-fg-muted">No calendars yet.</p>
			) : (
				<div className="space-y-4">
					{calendars.map((calendar) => (
						<CalendarFeedPanel
							key={calendar.id}
							calendarId={calendar.id}
							calendarName={calendar.name}
						/>
					))}
				</div>
			)}
		</SettingsShell>
	);
}
