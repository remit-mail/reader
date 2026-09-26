import { SettingsShell } from "@remit/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarCreateCard } from "@/components/settings/CalendarCreateCard";
import { CalendarSettingsPanel } from "@/components/settings/CalendarSettingsPanel";
import { CalendarSubscribeCard } from "@/components/settings/CalendarSubscribeCard";
import { CalendarSubscriptionStatus } from "@/components/settings/CalendarSubscriptionStatus";
import { useCalendarCollectionWrites } from "@/hooks/calendar/useCalendarCollectionWrites";
import { useCalendarSubscriptions } from "@/hooks/calendar/useCalendarSubscriptions";
import { useCalendars } from "@/hooks/calendar/useCalendars";
import { SETTINGS_ID_TO_PATH, SETTINGS_NAV_ITEMS } from "@/routes/settings";

export const Route = createFileRoute("/settings/calendars")({
	component: CalendarsSettings,
});

const calendarsHelp = (
	<div className="space-y-3">
		<p>
			Each calendar has a name, a time zone its floating times are read in, and
			an address CalDAV clients reach it by. The address is fixed when the
			calendar is added; the name and zone can change. Deleting a calendar
			deletes every event in it. The default calendar is where accepted
			invitations land, so it cannot be deleted.
		</p>
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
		<p>
			Subscribing works the other way round: paste another calendar's iCal
			address and its events show here, read-only, refreshed on a schedule.
		</p>
	</div>
);

function CalendarsSettings() {
	const navigate = useNavigate();
	const [helpOpen, setHelpOpen] = useState(true);
	const { calendars, collections, timeZoneByCalendarId, isLoading } =
		useCalendars();
	const subscriptions = useCalendarSubscriptions();
	const { createCalendar, isWriting } = useCalendarCollectionWrites();
	const [createProblem, setCreateProblem] = useState("");

	return (
		<SettingsShell
			items={SETTINGS_NAV_ITEMS}
			activeId="calendars"
			title="Calendars"
			description="Add, rename and delete calendars, subscribe to a calendar feed, and share one with any client that can subscribe to a URL."
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
			) : (
				<div className="space-y-4">
					{calendars.map((calendar) => {
						const collection = collections.find(
							(candidate) => candidate.calendarId === calendar.id,
						);
						return (
							<CalendarSettingsPanel
								key={calendar.id}
								calendarId={calendar.id}
								calendarName={calendar.name}
								timezone={timeZoneByCalendarId[calendar.id] ?? ""}
								subscription={
									collection?.source === "Subscribed" && (
										<CalendarSubscriptionStatus
											calendarName={collection.displayName}
											subscriptionUrl={collection.subscriptionUrl}
											enabled={collection.subscriptionEnabled}
											fetchedAt={collection.subscriptionFetchedAt}
											error={collection.subscriptionError}
											isBusy={subscriptions.togglingCalendarId === calendar.id}
											actionError={
												subscriptions.toggleFailure.calendarId === calendar.id
													? subscriptions.toggleFailure.error
													: undefined
											}
											onSetEnabled={(enabled) =>
												subscriptions.setEnabled(calendar.id, enabled)
											}
										/>
									)
								}
							/>
						);
					})}
					<CalendarSubscribeCard
						isBusy={subscriptions.isSubscribing}
						error={subscriptions.subscribeError}
						onSubscribe={subscriptions.subscribe}
					/>
					<CalendarCreateCard
						isBusy={isWriting}
						problem={createProblem}
						onCreate={(calendar) => {
							setCreateProblem("");
							return createCalendar(calendar).then((outcome) => {
								if (outcome.kind === "written") return true;
								setCreateProblem(outcome.message);
								return false;
							});
						}}
					/>
				</div>
			)}
		</SettingsShell>
	);
}
