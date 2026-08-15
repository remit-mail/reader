import { Button, cn } from "@remit/ui";
import {
	Check,
	ChevronDown,
	ChevronUp,
	Globe,
	Mail,
	Sparkles,
	TriangleAlert,
	Undo2,
	X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { SeamSuggestion } from "../../fixtures/calendar-mail.js";
import { ParseBadge, ParseProvenance } from "./parse-provenance.js";

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
	const needsZone = Boolean(entry.zoneOptions) && zoneChoice === "";

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
				<ParseBadge method={entry.method} />
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

			{entry.zoneOptions && (
				<div className="flex flex-col gap-1.5 rounded-md border border-warning/40 p-2">
					<p className="flex items-center gap-1.5 text-2xs font-semibold text-warning">
						<Globe className="size-3 shrink-0" aria-hidden />
						Which clock is this on?
					</p>
					{entry.zoneOptions.map((option) => (
						<button
							key={option.id}
							type="button"
							aria-pressed={zoneChoice === option.id}
							onClick={() => onZoneChoice(option.id)}
							className={cn(
								"rounded-md border px-2 py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
								touch && "min-h-11",
								zoneChoice === option.id
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
					disabled={needsZone}
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
			{needsZone && (
				<p className="text-2xs text-fg-subtle">
					Pick a clock first. The mail never said, and the reader will not
					choose for you.
				</p>
			)}
		</article>
	);
}

export interface RejectedNoticeProps {
	title: string;
	sender: string;
	senderAddress: string;
	ruled: boolean;
	onRule: () => void;
	onUndo: () => void;
	touch?: boolean;
}

/**
 * Rejecting one reading is a chance to stop the next twenty. The rule is
 * offered, never applied on the reader's behalf, and it is undoable while the
 * notice is still on screen.
 */
export function RejectedNotice({
	title,
	sender,
	senderAddress,
	ruled,
	onRule,
	onUndo,
	touch,
}: RejectedNoticeProps) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
			<p className="text-xs text-fg-muted">
				<span className="text-fg">{title}</span> dropped.
			</p>
			{ruled ? (
				<p className="text-xs text-fg">
					Nothing more will be suggested from {senderAddress}. Their mail still
					arrives as normal.
				</p>
			) : (
				<p className="text-xs text-fg-muted">
					{sender} sends mail like this often. Stop reading dates out of it?
				</p>
			)}
			<div className="flex items-center gap-2">
				{!ruled && (
					<Button
						variant="secondary"
						size={touch ? "md" : "sm"}
						onClick={onRule}
						className={cn(touch && "min-h-11")}
					>
						Never suggest from {sender}
					</Button>
				)}
				<Button
					variant="ghost"
					size={touch ? "md" : "sm"}
					icon={<Undo2 className="size-3.5" />}
					onClick={onUndo}
					className={cn(touch && "min-h-11")}
				>
					Undo
				</Button>
			</div>
		</div>
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

/* ------------------------------------------------------------------ */
/* Phone: one card at a time, swiped                                   */
/* ------------------------------------------------------------------ */

const COMMIT_DISTANCE = 96;

export interface SuggestionDeckProps {
	children: ReactNode;
	/** Empty when the deck has nothing left. */
	hasCard: boolean;
	onConfirm: () => void;
	onReject: () => void;
	blocked: boolean;
	blockedReason: string;
	remaining: number;
}

/**
 * The same cards on a phone, as a deck rather than a column: one decision
 * fills the screen, and the gesture is the fast path over the buttons that are
 * always there under it. A gesture is never the only way to answer.
 */
export function SuggestionDeck({
	children,
	hasCard,
	onConfirm,
	onReject,
	blocked,
	blockedReason,
	remaining,
}: SuggestionDeckProps) {
	const [drag, setDrag] = useState(0);
	const [from, setFrom] = useState<number | null>(null);

	if (!hasCard)
		return (
			<div className="flex flex-col items-center gap-2 p-8 text-center">
				<Sparkles className="size-6 text-fg-subtle" aria-hidden />
				<p className="text-sm text-fg-muted">
					Nothing in your mail is waiting on a decision about time.
				</p>
			</div>
		);

	const committing = Math.abs(drag) > COMMIT_DISTANCE;
	const towardsConfirm = drag > 0;

	return (
		<div className="flex flex-col gap-3 px-4 pb-4">
			<div className="relative">
				<div
					className="touch-pan-y select-none"
					style={{
						transform: `translateX(${drag}px) rotate(${drag / 40}deg)`,
						transition: from === null ? "transform 180ms ease-out" : "none",
					}}
					onPointerDown={(e) => {
						e.currentTarget.setPointerCapture(e.pointerId);
						setFrom(e.clientX);
					}}
					onPointerMove={(e) => {
						if (from === null) return;
						setDrag(e.clientX - from);
					}}
					onPointerUp={() => {
						if (Math.abs(drag) > COMMIT_DISTANCE) {
							if (drag > 0 && !blocked) onConfirm();
							if (drag < 0) onReject();
						}
						setFrom(null);
						setDrag(0);
					}}
					onPointerCancel={() => {
						setFrom(null);
						setDrag(0);
					}}
				>
					{children}
				</div>
				{committing && (
					<span
						className={cn(
							"pointer-events-none absolute top-3 rounded-md px-2 py-1 text-xs font-semibold",
							towardsConfirm
								? "right-3 bg-accent-soft text-accent"
								: "left-3 bg-danger-soft text-danger",
						)}
					>
						{towardsConfirm
							? blocked
								? blockedReason
								: "Confirm"
							: "Not this"}
					</span>
				)}
			</div>
			<p className="text-center text-2xs text-fg-subtle">
				{remaining} left · swipe right to confirm, left to drop, or use the
				buttons
			</p>
		</div>
	);
}
