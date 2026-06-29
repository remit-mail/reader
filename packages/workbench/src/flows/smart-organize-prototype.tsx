import { Avatar, Badge, BottomSheet, Button, cn, Input } from "@remit/ui";
import {
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export { BottomSheet };

// ── types ─────────────────────────────────────────────────────────────────────

type Scope = "just-these" | "all-like-these" | "future-mail";

type Category =
	| "newsletter"
	| "automated"
	| "transactional"
	| "personal"
	| undefined;

export interface InboxMessage {
	id: string;
	sender: string;
	email: string;
	subject: string;
	snippet: string;
	time: string;
	isRead: boolean;
	isTravel: boolean;
	category?: Category;
}

export interface MockMessage {
	sender: string;
	subject: string;
}

interface OrganizeSeed {
	folder?: string;
	label?: string | null;
	scope?: Scope;
}

export interface OrganizePanelProps {
	selectedMessages?: MockMessage[];
	search?: { query: string; count: number };
	initialScope?: Scope;
	similarCount?: number;
	seed?: OrganizeSeed;
	onClose?: () => void;
}

// ── mock LLM suggestions ────────────────────────────────────────────────────────

const PICK_READS = [
	"These look like booking confirmations.",
	"These look like travel reservations.",
	"These look like trip bookings.",
];

const LABEL_NAMES = ["Travel", "Bookings", "Trips"];

const FOLDERS = ["Inbox", "Travel", "Newsletters", "Receipts", "Archive"];

const SUGGESTED_ACTIONS: { id: string; label: string; seed: OrganizeSeed }[] = [
	{
		id: "label-travel",
		label: "Label as Travel",
		seed: { label: "Travel" },
	},
	{
		id: "keep-inbox",
		label: "Always keep in Inbox",
		seed: { folder: "Inbox", scope: "future-mail" },
	},
	{
		id: "unsubscribe",
		label: "Unsubscribe from these",
		seed: { folder: "Archive", label: null },
	},
	{
		id: "file-receipts",
		label: "File with receipts",
		seed: { folder: "Receipts", label: "Receipts" },
	},
];

// ── realistic inbox data ─────────────────────────────────────────────────────

export const INBOX_MESSAGES: InboxMessage[] = [
	{
		id: "airbnb-1",
		sender: "Airbnb",
		email: "no-reply@airbnb.com",
		subject: "Your reservation is confirmed — Lisbon, Jul 12–16",
		snippet: "Hi Matthijs, you're all set! Check-in from 15:00 on Jul 12.",
		time: "14:57",
		isRead: false,
		isTravel: true,
		category: "transactional",
	},
	{
		id: "booking-1",
		sender: "Booking.com",
		email: "noreply@booking.com",
		subject: "Booking confirmation: Hotel Bairro Alto",
		snippet:
			"Your booking is confirmed. Free cancellation until Jul 10. Reference: 3849201.",
		time: "13:22",
		isRead: false,
		isTravel: true,
		category: "transactional",
	},
	{
		id: "krugman-1",
		sender: "Paul Krugman",
		email: "newsletter@substack.com",
		subject: "Power and geopolitics — the new abnormal",
		snippet:
			"What we're seeing now isn't just a trade war. It's something more fundamental…",
		time: "11:04",
		isRead: true,
		isTravel: false,
		category: "newsletter",
	},
	{
		id: "expedia-1",
		sender: "Expedia",
		email: "expedia@expediamail.com",
		subject: "Your itinerary for the upcoming trip to Lisbon",
		snippet:
			"Flight TAP 832, Jul 12 · AMS → LIS 08:35. Hotel confirmed. Rental car ready.",
		time: "10:48",
		isRead: false,
		isTravel: true,
		category: "transactional",
	},
	{
		id: "github-1",
		sender: "GitHub",
		email: "noreply@github.com",
		subject: "[remit] PR #598: feat(ui): add message selection bar",
		snippet: "mvhenten opened a pull request: Adds multi-select to the inbox.",
		time: "09:31",
		isRead: true,
		isTravel: false,
		category: "automated",
	},
	{
		id: "lufthansa-1",
		sender: "Lufthansa",
		email: "noreply@lufthansa.com",
		subject: "Your boarding passes are ready for download",
		snippet:
			"Flight LH1946 · AMS → FRA → LIS · Jul 12. Online check-in closes 1h before.",
		time: "Yesterday",
		isRead: false,
		isTravel: true,
		category: "transactional",
	},
	{
		id: "abn-1",
		sender: "ABN AMRO",
		email: "noreply@abnamro.nl",
		subject: "Betaalbevestiging €218,00 — Booking.com",
		snippet:
			"Uw betaling van €218,00 aan Booking.com is geslaagd op 14 juni 2026.",
		time: "Yesterday",
		isRead: true,
		isTravel: false,
		category: "transactional",
	},
	{
		id: "eline-1",
		sender: "Eline",
		email: "eline@example.com",
		subject: "Re: weekend — kun je even bellen?",
		snippet: "Hoi, ik wilde even vragen of jij dit weekend…",
		time: "Mon",
		isRead: true,
		isTravel: false,
		category: "personal",
	},
	{
		id: "ryanair-1",
		sender: "Ryanair",
		email: "noreply@ryanair.com",
		subject: "Your return flight FR8842 — check in now",
		snippet:
			"Check in for your Jul 16 flight from LIS to AMS is now open. Save time.",
		time: "Mon",
		isRead: false,
		isTravel: true,
		category: "automated",
	},
	{
		id: "morning-brew",
		sender: "Morning Brew",
		email: "hello@morningbrew.com",
		subject: "The markets just did something unexpected",
		snippet:
			"Good morning. Futures are down 1.4% as of 7am ET. Here's what happened.",
		time: "Jul 9",
		isRead: true,
		isTravel: false,
		category: "newsletter",
	},
];

// ── icons ───────────────────────────────────────────────────────────────────────

type IconProps = { className?: string };

function makeIcon(paths: ReactNode, sw = 1.5) {
	return function Icon({ className }: IconProps) {
		return (
			<svg
				viewBox="0 0 24 24"
				className={className}
				fill="none"
				stroke="currentColor"
				strokeWidth={sw}
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				{paths}
			</svg>
		);
	};
}

const TrashIcon = makeIcon(
	<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" />,
);
const MoveIcon = makeIcon(
	<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
);
const JunkIcon = makeIcon(
	<>
		<path d="M12 3l9 16H3z" />
		<path d="M12 10v4M12 17v.01" />
	</>,
);
const HamburgerIcon = makeIcon(<path d="M4 6h16M4 12h16M4 18h16" />);

const SearchIcon = makeIcon(
	<>
		<circle cx="11" cy="11" r="7" />
		<path d="M21 21l-4.35-4.35" />
	</>,
);

const CheckIcon = makeIcon(<path d="M4 12l5 5L20 7" />, 2.5);

function ChevronUpIcon({ className }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M18 15l-6-6-6 6" />
		</svg>
	);
}

function RefreshIcon({ className }: IconProps) {
	return (
		<svg
			viewBox="0 0 12 12"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<path d="M10 6a4 4 0 1 1-1.17-2.83" />
			<path d="M10 2v2H8" />
		</svg>
	);
}

function EditIcon({ className }: IconProps) {
	return (
		<svg
			viewBox="0 0 12 12"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<path d="M8 2l2 2-5.5 5.5H3v-1.5L8 2z" />
		</svg>
	);
}

function XIcon({ className }: IconProps) {
	return (
		<svg
			viewBox="0 0 12 12"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<path d="M3 3l6 6M9 3l-6 6" />
		</svg>
	);
}

function ChevronDown({ className }: IconProps) {
	return (
		<svg
			viewBox="0 0 12 12"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<path d="M2 4l4 4 4-4" />
		</svg>
	);
}

function ArrowUp({ className }: IconProps) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M12 19V5M5 12l7-7 7 7" />
		</svg>
	);
}

// ── shared drag tuning (SelectionSheet) ─────────────────────────────────────────

const SNAP_MS = 320;
const SNAP_EASE = "cubic-bezier(0.32, 0.9, 0.3, 1)";
const FLICK_VELOCITY = 0.5; // px/ms

function rubberBand(overshoot: number): number {
	return Math.sign(overshoot) * Math.sqrt(Math.abs(overshoot)) * 4;
}

// ── SelectionSheet — peeking two-snap bottom sheet ──────────────────────────────
//
// COLLAPSED = slim teaser row (~56px): grabber pip, count, chevron-up hint.
// EXPANDED  = partial sheet (~min(38dvh, 320px)): grabber + quick actions +
//             two smart-flow rows, all with comfortable thumb targets.
//
// Dragging snaps between the two heights (no dismiss). Tapping the teaser
// expands; tapping the grabber when expanded collapses.

const TEASER_HEIGHT = 56;
const EXPANDED_MAX = 320; // px ceiling; CSS clamps to 38dvh below that

const STANDARD_ACTIONS = [
	{ id: "delete", label: "Delete", Icon: TrashIcon },
	{ id: "move", label: "Move", Icon: MoveIcon },
	{ id: "junk", label: "Junk", Icon: JunkIcon },
] as const;

export function SelectionSheet({
	count,
	onWiden,
	onNarrow,
	startExpanded = false,
}: {
	count: number;
	onWiden: () => void;
	onNarrow: () => void;
	startExpanded?: boolean;
}) {
	const [expanded, setExpanded] = useState(startExpanded);
	const containerRef = useRef<HTMLDivElement>(null);
	const [expandedHeight, setExpandedHeight] = useState(EXPANDED_MAX);

	// Measure the expanded height (the container when rendered at full size)
	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const measure = () => setExpandedHeight(el.offsetHeight);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Drag state: offset from the CURRENT snap position (positive = down)
	const [dragOffset, setDragOffset] = useState<number | null>(null);

	const pointer = useRef<{
		startY: number;
		lastY: number;
		lastT: number;
		velocity: number;
	} | null>(null);

	const onPointerDown = useCallback((e: React.PointerEvent) => {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		pointer.current = {
			startY: e.clientY,
			lastY: e.clientY,
			lastT: e.timeStamp,
			velocity: 0,
		};
		setDragOffset(0);
	}, []);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			const p = pointer.current;
			if (!p) return;
			const dt = e.timeStamp - p.lastT;
			if (dt > 0) p.velocity = (e.clientY - p.lastY) / dt;
			p.lastY = e.clientY;
			p.lastT = e.timeStamp;
			const delta = e.clientY - p.startY;
			// Allow rubber-band upward drag, resist downward past range
			const expandedH = expandedHeight;
			const range = expandedH - TEASER_HEIGHT;
			const clamped = expanded
				? // expanded: dragging up (negative) is rubberband, down is allowed up to range
					delta < 0
					? rubberBand(delta)
					: Math.min(delta, range + rubberBand(Math.max(0, delta - range)))
				: // collapsed: dragging down is rubberband, up is allowed up to range
					delta > 0
					? rubberBand(delta)
					: Math.max(delta, -range + rubberBand(Math.min(0, delta + range)));
			setDragOffset(clamped);
		},
		[expanded, expandedHeight],
	);

	const finishDrag = useCallback(() => {
		const p = pointer.current;
		pointer.current = null;
		if (!p) return;

		const delta = p.lastY - p.startY;
		const flick = Math.abs(p.velocity) > FLICK_VELOCITY;
		const expandedH = expandedHeight;
		const midpoint = (expandedH - TEASER_HEIGHT) / 2;

		let nextExpanded: boolean;
		if (flick) {
			// flick up → expand, flick down → collapse
			nextExpanded = p.velocity < 0;
		} else {
			// past midpoint: if expanded and dragged down past mid → collapse; vice versa
			nextExpanded = expanded ? delta < midpoint : delta < -midpoint;
		}

		setDragOffset(null);
		setExpanded(nextExpanded);
	}, [expanded, expandedHeight]);

	// Compute the visual translateY:
	// In collapsed state the sheet sits with only TEASER_HEIGHT visible.
	// expandedH = full height of container. translateY = expandedH - TEASER_HEIGHT keeps teaser visible.
	// During drag, offset modifies that.
	const collapsedTranslate = expandedHeight - TEASER_HEIGHT;
	const baseTranslate = expanded ? 0 : collapsedTranslate;
	const dragging = dragOffset !== null;
	const translate = baseTranslate + (dragOffset ?? 0);
	const transition = dragging ? "none" : `transform ${SNAP_MS}ms ${SNAP_EASE}`;

	return (
		<div
			ref={containerRef}
			className="absolute inset-x-0 bottom-0 flex select-none flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl shadow-black/40"
			style={{
				maxHeight: `min(${EXPANDED_MAX}px, 38dvh)`,
				// ensure container has enough room to be measured at full height
				minHeight: `${TEASER_HEIGHT}px`,
				transform: `translateY(${translate}px)`,
				transition,
			}}
		>
			{/* ── grabber / teaser row — always visible at the peek ── */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: click-only interaction in prototype UI */}
			<div
				role="slider"
				aria-label={
					expanded ? "Collapse selection actions" : "Expand selection actions"
				}
				aria-valuemin={0}
				aria-valuemax={1}
				aria-valuenow={expanded ? 1 : 0}
				tabIndex={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={finishDrag}
				onPointerCancel={finishDrag}
				onClick={() => {
					if (!dragging) setExpanded((v) => !v);
				}}
				className="flex cursor-grab touch-none flex-col items-center pt-2 active:cursor-grabbing"
			>
				{/* pip */}
				<div className="mb-1.5 h-1 w-10 rounded-full bg-fg-subtle/40" />

				{/* teaser row — count on left, hint on right */}
				<div className="flex w-full items-center px-4 pb-3">
					<span className="text-sm font-semibold text-fg">
						{count} selected
					</span>
					<span className="ml-auto flex items-center gap-1 text-xs text-fg-subtle">
						{expanded ? (
							<>
								<span>Collapse</span>
								<ChevronDown className="size-3" />
							</>
						) : (
							<>
								<span>Swipe up for actions</span>
								<ChevronUpIcon className="size-4" />
							</>
						)}
					</span>
				</div>
			</div>

			{/* ── expanded content — clipped when collapsed by translateY ── */}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
				{/* Quick actions row */}
				<div className="mb-3 flex items-center justify-around border-b border-line pb-3">
					{STANDARD_ACTIONS.map(({ id, label, Icon }) => (
						<Button
							key={id}
							variant="ghost"
							aria-label={label}
							icon={<Icon className="size-5" />}
							className="h-auto flex-1 flex-col gap-1 px-0 py-1.5 text-[11px]"
						>
							{label}
						</Button>
					))}
				</div>

				{/* Smart-flow rows */}
				<div className="flex flex-col gap-2">
					<Button
						variant="primary"
						onClick={onWiden}
						className="h-auto flex-col items-start gap-0 px-4 py-2.5 text-left"
					>
						<span className="text-sm font-semibold leading-tight">
							Select similar messages
						</span>
						<span className="text-xs opacity-80">find more like these</span>
					</Button>

					<Button
						variant="secondary"
						onClick={onNarrow}
						className="h-auto flex-col items-start gap-0 px-4 py-2.5 text-left"
					>
						<span className="text-sm font-medium leading-tight">
							Something else
						</span>
						<span className="text-xs text-fg-subtle">just deal with these</span>
					</Button>
				</div>
			</div>
		</div>
	);
}

// ── inline sentence bits ────────────────────────────────────────────────────────

function FolderPick({
	folder,
	onPick,
}: {
	folder: string;
	onPick: (f: string) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<span className="relative inline-block align-baseline">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="inline-flex min-h-7 items-center gap-1 rounded-full border border-accent-2 bg-accent-2-soft px-2.5 py-0.5 text-2xs font-semibold text-accent-2"
			>
				{folder}
				<ChevronDown className="size-2.5" />
			</button>
			{open && (
				<span className="absolute bottom-full left-0 z-10 mb-1 flex w-36 flex-col rounded-xl border border-line bg-surface py-1 shadow-lg">
					{FOLDERS.map((f) => (
						<button
							key={f}
							type="button"
							onClick={() => {
								onPick(f);
								setOpen(false);
							}}
							className={cn(
								"px-3 py-2 text-left text-2xs hover:bg-surface-sunken",
								f === folder ? "font-semibold text-accent-2" : "text-fg-muted",
							)}
						>
							{f}
						</button>
					))}
				</span>
			)}
		</span>
	);
}

function LabelBit({
	name,
	onRename,
	onRegenerate,
	onDrop,
}: {
	name: string;
	onRename: (n: string) => void;
	onRegenerate: () => void;
	onDrop: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(name);

	const commit = () => {
		if (draft.trim()) onRename(draft.trim());
		setEditing(false);
	};

	if (editing) {
		return (
			<input
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
					if (e.key === "Escape") {
						setDraft(name);
						setEditing(false);
					}
				}}
				className="w-20 rounded-full border border-accent-2 bg-surface px-2 py-0.5 text-2xs font-semibold text-accent-2 outline-none"
			/>
		);
	}

	return (
		<span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-accent-2 bg-accent-2-soft px-2.5 py-0.5 text-2xs font-semibold text-accent-2">
			<span className="size-1.5 rounded-full bg-accent-2" />
			{name}
			<button
				type="button"
				aria-label="Rename label"
				onClick={() => {
					setDraft(name);
					setEditing(true);
				}}
				className="text-accent-2/70 hover:text-accent-2"
			>
				<EditIcon className="size-2.5" />
			</button>
			<button
				type="button"
				aria-label="Suggest another name"
				onClick={onRegenerate}
				className="text-accent-2/70 hover:text-accent-2"
			>
				<RefreshIcon className="size-2.5" />
			</button>
			<button
				type="button"
				aria-label="Remove label"
				onClick={onDrop}
				className="text-accent-2/70 hover:text-accent-2"
			>
				<XIcon className="size-2.5" />
			</button>
		</span>
	);
}

// ── top app bar ──────────────────────────────────────────────────────────────────

export function AppBar() {
	return (
		<div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
			<button
				type="button"
				aria-label="Menu"
				className="flex size-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface-sunken"
			>
				<HamburgerIcon className="size-5" />
			</button>
			<span className="flex-1 text-sm font-semibold text-fg">Remit</span>
			<button
				type="button"
				aria-label="Search"
				className="flex size-8 items-center justify-center rounded-full text-fg-muted hover:bg-surface-sunken"
			>
				<SearchIcon className="size-5" />
			</button>
			<Avatar
				name="Matthijs van Henten"
				email="matthijs@example.com"
				size="sm"
			/>
		</div>
	);
}

// ── category badge tone map ──────────────────────────────────────────────────────

const categoryBadgeTone: Record<
	NonNullable<Category>,
	"neutral" | "accent" | "positive" | "warning"
> = {
	personal: "accent",
	newsletter: "neutral",
	automated: "neutral",
	transactional: "positive",
};

// ── inbox row ────────────────────────────────────────────────────────────────────

function SelectableAvatar({
	message,
	selected,
	onToggle,
}: {
	message: InboxMessage;
	selected: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={selected ? "Deselect" : "Select"}
			onClick={onToggle}
			className="relative shrink-0 focus:outline-none"
		>
			{selected ? (
				<span
					className="flex size-7 items-center justify-center rounded-full bg-accent-2"
					aria-hidden="true"
				>
					<CheckIcon className="size-4 text-white" />
				</span>
			) : (
				<Avatar name={message.sender} email={message.email} size="sm" />
			)}
		</button>
	);
}

export function InboxRow({
	message,
	selected,
	onToggle,
	onClick,
}: {
	message: InboxMessage;
	selected: boolean;
	onToggle: () => void;
	onClick?: () => void;
}) {
	const unread = !message.isRead;

	return (
		<div
			className={cn(
				"relative flex w-full items-start gap-3 py-2.5 pl-5 pr-3 text-left transition-colors",
				selected ? "bg-accent-2-soft" : unread ? "bg-surface" : "bg-surface",
			)}
		>
			{/* unread dot */}
			{unread && !selected && (
				<span className="absolute left-1.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-accent" />
			)}

			<SelectableAvatar
				message={message}
				selected={selected}
				onToggle={onToggle}
			/>

			{/* text block — tapping outside avatar opens the message */}
			<button
				type="button"
				onClick={onClick}
				className="min-w-0 flex-1 text-left"
			>
				<span className="flex items-baseline justify-between gap-1.5">
					<span
						className={cn(
							"truncate text-sm",
							unread ? "font-semibold text-fg" : "font-medium text-fg-muted",
						)}
					>
						{message.sender}
					</span>
					<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
						{message.time}
					</span>
				</span>
				<span
					className={cn(
						"block truncate text-sm",
						unread ? "text-fg" : "text-fg-muted",
					)}
				>
					{message.subject}
				</span>
				<span className="flex items-center gap-1.5">
					<span className="line-clamp-1 min-w-0 flex-1 text-xs text-fg-subtle">
						{message.snippet}
					</span>
					{message.category && message.category !== "personal" && (
						<Badge
							tone={categoryBadgeTone[message.category]}
							className="shrink-0"
						>
							{message.category}
						</Badge>
					)}
				</span>
			</button>
		</div>
	);
}

// ── Beat 2b — SOMETHING ELSE ─────────────────────────────────────────────────────

export function SomethingElse({
	onPick,
}: {
	onPick: (seed: OrganizeSeed) => void;
}) {
	const [text, setText] = useState("");

	const submit = () => {
		const t = text.trim();
		if (!t) return;
		const lower = t.toLowerCase();
		const folder = FOLDERS.find((f) => lower.includes(f.toLowerCase()));
		onPick({ folder, label: folder ?? "Travel" });
	};

	return (
		<div className="flex min-h-0 flex-col">
			<div className="px-row-inset pb-1 pt-1">
				<h2 className="text-sm font-semibold text-fg-muted">
					What should Remit do?
				</h2>
			</div>
			<div className="flex-1 space-y-2 overflow-y-auto px-row-inset py-3">
				{SUGGESTED_ACTIONS.map(({ id, label, seed }) => (
					<Button
						key={id}
						variant="secondary"
						onClick={() => onPick(seed)}
						className="h-12 w-full justify-start px-4"
					>
						{label}
					</Button>
				))}
			</div>
			<div className="flex items-center gap-2 border-t border-line px-row-inset py-3">
				<Input
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && submit()}
					placeholder="Tell Remit what to do…"
					className="flex-1"
				/>
				<Button
					variant="primary"
					aria-label="Send"
					onClick={submit}
					disabled={!text.trim()}
					icon={<ArrowUp className="size-4" />}
					className="size-9 shrink-0 px-0"
				/>
			</div>
		</div>
	);
}

// ── Beat 3 — ORGANIZE PANEL ──────────────────────────────────────────────────────

export function OrganizePanel({
	selectedMessages,
	search,
	initialScope = "all-like-these",
	similarCount = 47,
	seed,
}: OrganizePanelProps) {
	const [scope, setScope] = useState<Scope>(seed?.scope ?? initialScope);
	const [readIdx, setReadIdx] = useState(0);
	const [labelIdx, setLabelIdx] = useState(0);
	const seededLabel = seed && "label" in seed ? seed.label : LABEL_NAMES[0];
	const [labelName, setLabelName] = useState(seededLabel ?? LABEL_NAMES[0]);
	const [hasLabel, setHasLabel] = useState(seededLabel !== null);
	const [folder, setFolder] = useState(seed?.folder ?? "Inbox");
	const [hasFolder, setHasFolder] = useState(true);

	const regenerateLabel = () => {
		const next = (labelIdx + 1) % LABEL_NAMES.length;
		setLabelIdx(next);
		setLabelName(LABEL_NAMES[next]);
	};

	const baseCount = selectedMessages?.length ?? search?.count ?? 1;
	const totalCount =
		scope === "just-these" ? baseCount : baseCount + similarCount;

	const isSelectionMode = !!selectedMessages;
	const always = scope === "future-mail";
	const subject = scope === "just-these" ? "these" : "emails like these";
	const ctaLabel = always
		? "Always do this"
		: `Organize ${totalCount} message${totalCount !== 1 ? "s" : ""}`;

	return (
		<div className="flex min-h-0 flex-col">
			<div className="px-row-inset pb-1 pt-1">
				<h2 className="text-sm font-semibold text-fg-muted">Organize</h2>
			</div>

			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-row-inset py-3">
				<section>
					{isSelectionMode && selectedMessages ? (
						<div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-sunken">
							{selectedMessages.map((msg, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: list is static, no stable id
								<div key={i} className="flex items-start gap-2.5 px-3 py-2">
									<Avatar name={msg.sender} size="sm" />
									<div className="min-w-0 flex-1">
										<p className="truncate text-2xs font-medium text-fg-muted">
											{msg.sender}
										</p>
										<p className="truncate text-2xs text-fg-subtle">
											{msg.subject}
										</p>
									</div>
								</div>
							))}
						</div>
					) : search ? (
						<p className="text-2xs text-fg-subtle">
							Results for{" "}
							<span className="font-medium text-fg-muted">
								'{search.query}'
							</span>{" "}
							· {search.count} messages
						</p>
					) : null}
				</section>

				<section className="flex items-center gap-2">
					<p className="text-sm text-fg-muted">{PICK_READS[readIdx]}</p>
					<button
						type="button"
						aria-label="Look again"
						onClick={() => setReadIdx((v) => (v + 1) % PICK_READS.length)}
						className="text-fg-subtle hover:text-fg-muted"
					>
						<RefreshIcon className="size-3" />
					</button>
				</section>

				<section className="rounded-xl border border-line bg-surface-sunken p-3">
					<p className="text-sm leading-8 text-fg-muted">
						{always && <span className="font-semibold">Always </span>}
						{always ? "keep" : "Keep"} {subject} in your{" "}
						{hasFolder ? (
							<FolderPick folder={folder} onPick={setFolder} />
						) : (
							<button
								type="button"
								onClick={() => setHasFolder(true)}
								className="text-2xs text-fg-subtle underline"
							>
								pick a place
							</button>
						)}
						{hasLabel && (
							<>
								{" "}
								and label them{" "}
								<LabelBit
									name={labelName}
									onRename={setLabelName}
									onRegenerate={regenerateLabel}
									onDrop={() => setHasLabel(false)}
								/>
							</>
						)}
						.
					</p>
					{!hasLabel && (
						<button
							type="button"
							onClick={() => setHasLabel(true)}
							className="mt-1 text-2xs text-fg-subtle underline"
						>
							+ add a label
						</button>
					)}
					{always && (
						<p className="mt-2 text-2xs text-fg-subtle">
							Applies to these {totalCount} and new mail like them.
						</p>
					)}
				</section>

				<section className="space-y-1.5">
					{(
						[
							{
								id: "just-these" as Scope,
								label: `Just these ${baseCount}`,
							},
							{
								id: "all-like-these" as Scope,
								label: `All ${totalCount} like these`,
							},
							{
								id: "future-mail" as Scope,
								label: "These and new mail like this",
							},
						] satisfies { id: Scope; label: string }[]
					).map(({ id, label }) => (
						<button
							key={id}
							type="button"
							onClick={() => setScope(id)}
							className={cn(
								"flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 text-left text-2xs font-medium transition-colors",
								scope === id
									? "border-accent-2 bg-accent-2-soft text-accent-2"
									: "border-line bg-surface text-fg-muted",
							)}
						>
							<span
								className={cn(
									"flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors",
									scope === id
										? "border-accent-2 bg-accent-2"
										: "border-line bg-surface",
								)}
							>
								{scope === id && (
									<span className="size-1.5 rounded-full bg-white" />
								)}
							</span>
							{label}
						</button>
					))}
				</section>
			</div>

			<div className="space-y-2 border-t border-line bg-surface px-row-inset py-3">
				<Button
					variant="primary"
					disabled={!hasFolder && !hasLabel}
					className="h-11 w-full font-semibold"
				>
					{ctaLabel}
				</Button>
				<Button variant="ghost" className="h-11 w-full">
					Not now
				</Button>
			</div>
		</div>
	);
}

// ── REALISTIC INTERACTIVE INBOX ──────────────────────────────────────────────────

type Stage = "inbox" | "widening" | "something-else" | "organize";

export function RealisticInbox({
	messages = INBOX_MESSAGES,
	similarCount = 47,
}: {
	messages?: InboxMessage[];
	similarCount?: number;
}) {
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [stage, setStage] = useState<Stage>("inbox");
	const [seed, setSeed] = useState<OrganizeSeed | undefined>();
	const [widenedIds, setWidenedIds] = useState<Set<string>>(new Set());

	const toggleSelect = useCallback((id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const selectionCount = selected.size + widenedIds.size;

	const widen = () => {
		setStage("widening");
		window.setTimeout(() => {
			const travelIds = new Set(
				messages
					.filter((m) => m.isTravel && !selected.has(m.id))
					.map((m) => m.id),
			);
			setWidenedIds(travelIds);
			setStage("organize");
		}, 900);
	};

	const selectedMessages: MockMessage[] = messages
		.filter((m) => selected.has(m.id) || widenedIds.has(m.id))
		.map((m) => ({ sender: m.sender, subject: m.subject }));

	const showSheet = selected.size >= 2;

	return (
		<div className="relative flex h-full flex-col overflow-hidden bg-surface">
			<AppBar />

			{/* brief header */}
			<div className="border-b border-line bg-surface px-row-inset py-2">
				<p className="text-xs font-medium text-fg-muted">
					Daily brief ·{" "}
					<span className="text-accent">
						{messages.filter((m) => !m.isRead).length} unread
					</span>
				</p>
			</div>

			{/* message list — bottom padding gives the teaser enough room */}
			<div
				className="min-h-0 flex-1 divide-y divide-line overflow-y-auto"
				style={{
					paddingBottom: showSheet && stage === "inbox" ? TEASER_HEIGHT : 0,
				}}
			>
				{messages.map((msg) => (
					<InboxRow
						key={msg.id}
						message={msg}
						selected={selected.has(msg.id) || widenedIds.has(msg.id)}
						onToggle={() => toggleSelect(msg.id)}
					/>
				))}
			</div>

			{/* peeking selection sheet — rises when ≥2 selected */}
			{showSheet && stage === "inbox" && (
				<SelectionSheet
					count={selectionCount}
					onWiden={widen}
					onNarrow={() => setStage("something-else")}
				/>
			)}

			{/* widening flash */}
			{stage === "widening" && (
				<div className="absolute inset-0 z-50 flex items-end justify-center pb-24">
					<div className="animate-pulse rounded-full bg-accent-2 px-4 py-2 text-2xs font-semibold text-white shadow-lg">
						Selecting {similarCount} similar…
					</div>
				</div>
			)}

			<BottomSheet
				open={stage === "something-else"}
				onClose={() => setStage("inbox")}
			>
				<SomethingElse
					onPick={(s) => {
						setSeed(s);
						setStage("organize");
					}}
				/>
			</BottomSheet>

			<BottomSheet
				open={stage === "organize"}
				onClose={() => {
					setWidenedIds(new Set());
					setStage("inbox");
				}}
			>
				<OrganizePanel
					selectedMessages={selectedMessages}
					similarCount={similarCount}
					initialScope="all-like-these"
					seed={seed}
				/>
			</BottomSheet>
		</div>
	);
}

// ── legacy flow wrapper (kept for Walkthrough story) ─────────────────────────────

export function SmartOrganizeFlow({
	selectedMessages = [],
	similarCount = 47,
}: {
	selectedMessages?: MockMessage[];
	similarCount?: number;
}) {
	const [stage, setStage] = useState<Stage>("inbox");
	const [widened, setWidened] = useState(false);
	const [seed, setSeed] = useState<OrganizeSeed | undefined>();

	const widen = () => {
		setStage("widening");
		window.setTimeout(() => {
			setWidened(true);
			setStage("organize");
		}, 900);
	};

	const count = widened
		? selectedMessages.length + similarCount
		: selectedMessages.length;

	return (
		<div className="relative h-full overflow-hidden bg-surface">
			{/* realistic inbox as backdrop */}
			<div className="divide-y divide-line opacity-60">
				{INBOX_MESSAGES.slice(0, 9).map((msg) => (
					<div
						key={msg.id}
						className="flex items-start gap-3 px-row-inset py-2.5"
					>
						<Avatar name={msg.sender} email={msg.email} size="sm" />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium text-fg-muted">
								{msg.sender}
							</p>
							<p className="truncate text-xs text-fg-subtle">{msg.subject}</p>
						</div>
					</div>
				))}
			</div>

			{stage === "inbox" && count >= 2 && (
				<SelectionSheet
					count={count}
					onWiden={widen}
					onNarrow={() => setStage("something-else")}
				/>
			)}

			{stage === "widening" && (
				<div className="absolute inset-0 z-50 flex items-end justify-center pb-24">
					<div className="animate-pulse rounded-full bg-accent-2 px-4 py-2 text-2xs font-semibold text-white shadow-lg">
						Selecting {similarCount} similar…
					</div>
				</div>
			)}

			<BottomSheet
				open={stage === "something-else"}
				onClose={() => setStage("inbox")}
			>
				<SomethingElse
					onPick={(s) => {
						setSeed(s);
						setStage("organize");
					}}
				/>
			</BottomSheet>

			<BottomSheet
				open={stage === "organize"}
				onClose={() => setStage("inbox")}
			>
				<OrganizePanel
					selectedMessages={selectedMessages}
					similarCount={similarCount}
					initialScope="all-like-these"
					seed={seed}
				/>
			</BottomSheet>
		</div>
	);
}
