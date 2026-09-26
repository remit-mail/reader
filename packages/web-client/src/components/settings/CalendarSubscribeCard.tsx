/**
 * Settings › Calendars: subscribe a new calendar to a read-only iCalendar
 * address (issue #1261).
 *
 * Presentational. The server reads the feed before it creates anything, so a
 * refusal here means nothing was added, and the banner says so in those words.
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
import { CalendarPlus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { formatErrorMessage } from "@/components/ui/ErrorState";

export interface CalendarSubscribeCardProps {
	isBusy: boolean;
	/** The subscribe the server turned down. */
	error: unknown;
	onSubscribe: (
		request: { displayName: string; url: string },
		onDone: () => void,
	) => void;
}

export const SUBSCRIBE_TITLE = "Subscribe to a calendar";

export function CalendarSubscribeCard({
	isBusy,
	error,
	onSubscribe,
}: CalendarSubscribeCardProps) {
	const titleId = useId();
	const nameId = useId();
	const urlId = useId();
	const [displayName, setDisplayName] = useState("");
	const [url, setUrl] = useState("");
	const ready = displayName.trim() !== "" && url.trim() !== "";

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!ready) return;
		onSubscribe({ displayName, url }, () => {
			setDisplayName("");
			setUrl("");
		});
	};

	return (
		<Card className="max-w-xl" role="region" aria-labelledby={titleId}>
			<CardHeader>
				<CardTitle id={titleId}>{SUBSCRIBE_TITLE}</CardTitle>
			</CardHeader>
			<CardBody>
				<form className="space-y-3" onSubmit={submit}>
					<p className="text-sm text-fg-muted">
						Paste the secret iCal address from Google Calendar, a published
						Outlook calendar or any other feed. It shows here read-only and
						refreshes on its own.
					</p>
					<div className="space-y-1">
						<label htmlFor={nameId} className="text-sm font-medium text-fg">
							Calendar name
						</label>
						<Input
							id={nameId}
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder="Team rota"
							autoComplete="off"
						/>
					</div>
					<div className="space-y-1">
						<label htmlFor={urlId} className="text-sm font-medium text-fg">
							Calendar address
						</label>
						<Input
							id={urlId}
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
							autoComplete="off"
							spellCheck={false}
							inputMode="url"
						/>
						<p className="text-xs text-fg-muted">
							For Google Calendar the address is the password to the calendar.
							Reader never shows it in full again.
						</p>
					</div>
					<Button
						type="submit"
						variant="primary"
						size="sm"
						disabled={!ready || isBusy}
						icon={<CalendarPlus className="size-3.5" />}
					>
						{isBusy ? "Subscribing…" : "Subscribe"}
					</Button>
					{error !== undefined && error !== null && (
						<Banner tone="danger" variant="soft">
							<p className="font-medium">The calendar was not added.</p>
							<p className="mt-0.5 break-words">{formatErrorMessage(error)}</p>
						</Banner>
					)}
				</form>
			</CardBody>
		</Card>
	);
}
