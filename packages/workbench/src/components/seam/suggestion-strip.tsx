import { Button, CalendarParseBadge, cn, settleZone } from "@remit/ui";
import {
	Check,
	ChevronDown,
	ChevronUp,
	Globe,
	Mail,
	Sparkles,
	TriangleAlert,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SeamSuggestion } from "../../fixtures/calendar-mail.js";
import { ParseProvenance } from "./parse-provenance.js";

/**
 * Everything the reader has found in mail and has not been allowed to act on.
 * A suggestion is never a block on the grid and never a half-event that has to
 * be noticed and removed: it is a card, off the calendar, and the only way onto
 * the calendar is a person pressing Confirm. One junk entry costs more trust
 * than the whole feature earns, so the default is to do nothing.
 */

export interface SuggestionCardProps {
	entry: SeamSuggestion;
	whenText: string;
	expanded: boolean;
	onToggleExpanded: () => void;
	zoneChoice: string;
	onZoneChoice: (id: string) => void;
	onConfirm: () => void;
	onReject: () => void;
	onOpenThread: () => void;
	touch?: boolean;
	className?: string;
}

export function SuggestionCard({
	entry,
	whenText,
	expanded,
	onToggleExpanded,
	zoneChoice,
	onZoneChoice,
	onConfirm,
	onReject,
	onOpenThread,
	touch,
	className,
}: SuggestionCardProps) {
	const { suggestion } = entry;
	const zoneOptions = suggestion.zoneOptions;
	const settlement = settleZone(suggestion, zoneChoice);

	return (
		<article
			className={cn(
				"flex flex-col gap-2 rounded-lg border border-dashed border-line-strong bg-surface-sunken p-3",
				className,
			)}
		>
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-2xs uppercase tracking-wider text-fg-subtle">
					Not on your calendar
				</span>
				<CalendarParseBadge method={entry.method} />
			</div>

			<div>
				<h3 className="truncate text-sm font-semibold text-fg">
					{suggestion.title}
				</h3>
				<p className="text-xs tabular-nums text-fg-muted">{whenText}</p>
				{suggestion.location !== "" && (
					<p className="truncate text-xs text-fg-subtle">
						{suggestion.location}
					</p>
				)}
			</div>

			<button
				type="button"
				onClick={onOpenThread}
				className={cn(
					"flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left text-2xs text-accent-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
					touch && "min-h-9",
				)}
			>
				<Mail className="size-3 shrink-0" aria-hidden />
				<span className="truncate">
					{suggestion.sender} — {suggestion.threadSubject}
				</span>
			</button>

			{suggestion.ambiguity !== "" && (
				<p className="flex items-start gap-1.5 rounded-md bg-warning-soft p-2 text-2xs text-warning">
					<TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
					{suggestion.ambiguity}
				</p>
			)}

			{zoneOptions && (
				<div className="flex flex-col gap-1.5 rounded-md border border-warning/40 p-2">
					<p className="flex items-center gap-1.5 text-2xs font-semibold text-warning">
						<Globe className="size-3 shrink-0" aria-hidden />
						Which clock is this on?
					</p>
					{zoneOptions.map((option) => (
						<button
							key={option.timeZone}
							type="button"
							aria-pressed={zoneChoice === option.timeZone}
							onClick={() => onZoneChoice(option.timeZone)}
							className={cn(
								"rounded-md border px-2 py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
								touch && "min-h-11",
								zoneChoice === option.timeZone
									? "border-accent bg-accent-soft"
									: "border-line bg-surface hover:border-line-strong",
							)}
						>
							<span className="block text-xs font-medium text-fg">
								{option.label}
							</span>
							<span className="block text-2xs text-fg-subtle">
								{option.note}
							</span>
						</button>
					))}
				</div>
			)}

			<button
				type="button"
				onClick={onToggleExpanded}
				aria-expanded={expanded}
				className={cn(
					"flex items-center gap-1 self-start rounded-sm text-2xs text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring",
					touch && "min-h-9",
				)}
			>
				{expanded ? (
					<ChevronUp className="size-3" aria-hidden />
				) : (
					<ChevronDown className="size-3" aria-hidden />
				)}
				{expanded ? "Hide the reading" : "Show the reading"}
			</button>

			{expanded && (
				<ParseProvenance
					method={entry.method}
					evidence={entry.evidence}
					fields={entry.fields}
					className="rounded-md border border-line bg-surface p-2"
				/>
			)}

			<div className={cn("flex items-center gap-2", touch && "flex-wrap")}>
				<Button
					variant="primary"
					size={touch ? "md" : "sm"}
					icon={<Check className="size-3.5" />}
					onClick={onConfirm}
					disabled={!settlement.settled}
					className={cn(touch && "min-h-11 flex-1")}
				>
					Confirm
				</Button>
				<Button
					variant="secondary"
					size={touch ? "md" : "sm"}
					icon={<X className="size-3.5" />}
					onClick={onReject}
					className={cn(touch && "min-h-11 flex-1")}
				>
					Not this
				</Button>
			</div>
			{!settlement.settled && (
				<p className="text-2xs text-fg-subtle">{settlement.reason}</p>
			)}
		</article>
	);
}

export function SuggestionHeading({
	count,
	ruleCount,
	touch,
	children,
}: {
	count: number;
	ruleCount: number;
	touch?: boolean;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-2 px-row-inset",
				touch ? "min-h-11" : "h-8",
			)}
		>
			<Sparkles className="size-3.5 shrink-0 text-accent-2" aria-hidden />
			<h2 className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				Waiting for you · {count}
			</h2>
			{ruleCount > 0 && (
				<span className="shrink-0 text-2xs text-fg-subtle">
					{ruleCount} senders muted
				</span>
			)}
			{children}
		</div>
	);
}
