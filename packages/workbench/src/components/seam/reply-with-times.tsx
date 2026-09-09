import { Button, type CalendarSlotPick, cn } from "@remit/ui";
import { CornerUpLeft, Timer, X } from "lucide-react";
import { HOLD_EXPIRY_LABEL } from "../../fixtures/calendar-mail.js";

/**
 * Answering with times. The slots go into the reply as plain text, because the
 * person on the other end may be reading it in anything, and the same slots go
 * onto the calendar as holds, because an offer you have forgotten you made is
 * how double bookings happen. The hold is drawn as provisional and releases
 * itself; it is not an event and never becomes one without an answer.
 */

export function composeReply(
	recipientFirstName: string,
	dayLabel: string,
	slots: CalendarSlotPick[],
): string {
	if (slots.length === 0)
		return `Hoi ${recipientFirstName},\n\nPick a time below and I will send the invite.\n\nAlice`;
	const lines = slots.map(
		(slot) => `· ${dayLabel}, ${slot.startTime}–${slot.endTime}`,
	);
	return [
		`Hoi ${recipientFirstName},`,
		"",
		"Any of these work for me:",
		...lines,
		"",
		"Take whichever suits and I will send the invite.",
		"",
		"Alice",
	].join("\n");
}

export interface ReplyWithTimesProps {
	slots: CalendarSlotPick[];
	dayLabel: string;
	draft: string;
	onDraftChange: (value: string) => void;
	onRemoveSlot: (slot: CalendarSlotPick) => void;
	onSend: () => void;
	sent: boolean;
	onRelease: () => void;
	touch?: boolean;
	className?: string;
}

export function ReplyWithTimes({
	slots,
	dayLabel,
	draft,
	onDraftChange,
	onRemoveSlot,
	onSend,
	sent,
	onRelease,
	touch,
	className,
}: ReplyWithTimesProps) {
	if (sent)
		return (
			<section
				className={cn(
					"flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3",
					className,
				)}
			>
				<p className="flex items-center gap-2 text-sm text-fg">
					<CornerUpLeft
						className="size-4 shrink-0 text-fg-subtle"
						aria-hidden
					/>
					Reply sent with {slots.length} times.
				</p>
				<p className="flex items-start gap-2 text-xs text-fg-muted">
					<Timer
						className="mt-0.5 size-3.5 shrink-0 text-accent-2"
						aria-hidden
					/>
					{slots.length} holds are on {dayLabel}, drawn dashed so they never
					read as agreed. They release themselves at {HOLD_EXPIRY_LABEL} if
					nobody picks one.
				</p>
				<Button
					variant="secondary"
					size={touch ? "md" : "sm"}
					onClick={onRelease}
					className={cn("self-start", touch && "min-h-11")}
				>
					Release them now
				</Button>
			</section>
		);

	return (
		<section
			className={cn(
				"flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3",
				className,
			)}
		>
			<div className="flex items-center gap-2">
				<CornerUpLeft className="size-4 shrink-0 text-fg-subtle" aria-hidden />
				<h3 className="min-w-0 flex-1 text-sm font-medium text-fg">
					Reply with times
				</h3>
				<span className="shrink-0 text-2xs text-fg-subtle">
					{slots.length} picked
				</span>
			</div>

			{slots.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{slots.map((slot) => (
						<span
							key={slot.startTime}
							className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent-soft py-0.5 pl-2 pr-1 text-xs tabular-nums text-accent"
						>
							{slot.startTime} – {slot.endTime}
							<button
								type="button"
								aria-label={`Drop ${slot.startTime}`}
								onClick={() => onRemoveSlot(slot)}
								className={cn(
									"flex items-center justify-center rounded-sm outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring",
									touch ? "size-9" : "size-4",
								)}
							>
								<X className="size-3" />
							</button>
						</span>
					))}
				</div>
			)}

			<textarea
				value={draft}
				onChange={(e) => onDraftChange(e.target.value)}
				rows={touch ? 7 : 9}
				aria-label="Reply draft"
				className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>

			<p className="flex items-start gap-2 text-2xs text-fg-muted">
				<Timer className="mt-0.5 size-3 shrink-0 text-accent-2" aria-hidden />
				Sending also holds these slots on {dayLabel} until {HOLD_EXPIRY_LABEL}.
				A hold is provisional, private, and releases itself.
			</p>

			<Button
				variant="primary"
				size={touch ? "md" : "sm"}
				onClick={onSend}
				disabled={slots.length === 0}
				className={cn("self-start", touch && "min-h-11 w-full")}
			>
				Send and hold
			</Button>
		</section>
	);
}
