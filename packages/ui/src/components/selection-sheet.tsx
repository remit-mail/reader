import {
	ChevronUp,
	Loader2,
	MailOpen,
	ShieldAlert,
	Trash2,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { cn } from "../lib/cn.js";
import { Banner, type BannerTone } from "./banner.js";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import { ProgressBar } from "./progress-bar.js";

const formatCount = (n: number): string => n.toLocaleString();

/** The peek height of the collapsed teaser row (px). */
export const SELECTION_SHEET_TEASER_HEIGHT = 56;
/** Ceiling on the expanded sheet height (px); CSS clamps to a third of the
 *  viewport below this. */
const EXPANDED_MAX = 320;

const SNAP_MS = 320;
const SNAP_EASE = "cubic-bezier(0.32, 0.9, 0.3, 1)";
const FLICK_VELOCITY = 0.5; // px/ms

function rubberBand(overshoot: number): number {
	return Math.sign(overshoot) * Math.sqrt(Math.abs(overshoot)) * 4;
}

export interface SheetSnapInput {
	/** The snap state the drag started from. */
	expanded: boolean;
	/** Net vertical travel over the drag (px); positive is downward. */
	delta: number;
	/** Terminal pointer velocity (px/ms); positive is downward. */
	velocity: number;
	/** Measured full height of the expanded sheet (px). */
	expandedHeight: number;
	/** Peek height of the collapsed teaser (px). */
	teaserHeight: number;
	/** Speed past which a drag is a flick, snapping in its direction. */
	flickVelocity?: number;
}

/**
 * The two-snap decision the sheet makes when a drag ends: a flick snaps in its
 * own direction; otherwise the sheet settles to whichever snap point the drag
 * crossed the midpoint toward. Pure so the snap behaviour is testable without a
 * pointer or a DOM.
 */
export function resolveSheetSnap({
	expanded,
	delta,
	velocity,
	expandedHeight,
	teaserHeight,
	flickVelocity = FLICK_VELOCITY,
}: SheetSnapInput): boolean {
	if (Math.abs(velocity) > flickVelocity) return velocity < 0;
	const midpoint = (expandedHeight - teaserHeight) / 2;
	return expanded ? delta < midpoint : delta < -midpoint;
}

export type SelectionSheetMode = "idle" | "counting" | "running" | "escalated";

export interface SelectionSheetNoticeAction {
	label: string;
	onClick: () => void;
}

export interface SelectionSheetNotice {
	tone: BannerTone;
	text: string;
	action?: SelectionSheetNoticeAction;
}

export interface SelectionSheetProps {
	count: number;
	/**
	 * Which content the sheet routes to. `idle` shows the quick actions and the
	 * smart-flow rows; `counting`/`running` replace them with the paging status,
	 * progress and notice; `escalated` keeps the quick actions over the whole
	 * predicate. Defaults to `idle`.
	 */
	mode?: SelectionSheetMode;
	/** The X / stop control — exits selection, or stops a run in progress. */
	onCancel: () => void;
	onDelete: () => void;
	/** Move to the Junk mailbox. Omitted (hidden) in the Junk folder itself, or
	 *  when no Junk folder is appointed. */
	onJunk?: () => void;
	/** Optional — hidden while a run is in flight or the total is still counting. */
	onMarkRead?: () => void;
	/** Widen the selection to similar mail, then open Organize. */
	onSelectSimilar?: () => void;
	/** Open Organize with the current selection to choose an action. */
	onSomethingElse?: () => void;
	/**
	 * Move-to-folder trigger, rendered as the middle quick action. Kept as a
	 * render prop so the caller owns the folder-picker data and API deps.
	 */
	moveSlot?: ReactNode;
	/** True while a delete or move mutation is in flight. */
	isBusy?: boolean;
	/** Select-all-loaded control, rendered above the quick actions when present. */
	selectAll?: {
		checked: boolean;
		indeterminate?: boolean;
		onChange: () => void;
	};
	/** Overrides the default "{count} messages selected" status text. */
	statusLabel?: string;
	/** Determinate progress for a bulk run in flight. */
	progress?: { value: number; max: number; tone?: BannerTone };
	/** At-most-one toned status line: an escalation offer, a Stop, a Retry, or a
	 *  cross-account move restriction. */
	notice?: SelectionSheetNotice;
	/** Start expanded rather than at the teaser — for stories and the counting /
	 *  running states, which need their status visible. */
	startExpanded?: boolean;
}

/**
 * The mobile multi-select surface: a peeking bottom sheet that teases at ~56px
 * with the selection count, and expands by drag or tap to a third-height sheet
 * carrying the bulk verbs (Delete / Move / Junk), the select-similar → organize
 * entries, and every escalation state (counting, running progress,
 * partial-failure) the selection can be in. Drag or tap the grabber to collapse
 * back to the teaser; the selection is untouched.
 *
 * Sits absolutely against the bottom of the nearest positioned ancestor, so the
 * list it belongs to must be a `relative` container and pad its own bottom by
 * {@link SELECTION_SHEET_TEASER_HEIGHT} so no row hides behind the teaser.
 */
export function SelectionSheet({
	count,
	mode = "idle",
	onCancel,
	onDelete,
	onJunk,
	onMarkRead,
	onSelectSimilar,
	onSomethingElse,
	moveSlot,
	isBusy = false,
	selectAll,
	statusLabel,
	progress,
	notice,
	startExpanded = false,
}: SelectionSheetProps) {
	const [expanded, setExpanded] = useState(startExpanded);
	const containerRef = useRef<HTMLDivElement>(null);
	const [expandedHeight, setExpandedHeight] = useState(EXPANDED_MAX);

	// A run or a live count owns the sheet: it stays open so the progress and
	// status can't be dragged out of sight mid-operation.
	const locked = mode === "counting" || mode === "running";
	useEffect(() => {
		if (locked) setExpanded(true);
	}, [locked]);

	useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const measure = () => setExpandedHeight(el.offsetHeight);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Offset from the current snap position (positive = dragged down).
	const [dragOffset, setDragOffset] = useState<number | null>(null);
	const pointer = useRef<{
		startY: number;
		lastY: number;
		lastT: number;
		velocity: number;
	} | null>(null);
	// True once a pointer-down has actually moved, so the click the browser fires
	// on pointer-up after a drag doesn't also toggle the snap state and undo it.
	const movedRef = useRef(false);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			if (locked) return;
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			pointer.current = {
				startY: e.clientY,
				lastY: e.clientY,
				lastT: e.timeStamp,
				velocity: 0,
			};
			movedRef.current = false;
			setDragOffset(0);
		},
		[locked],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			const p = pointer.current;
			if (!p) return;
			const dt = e.timeStamp - p.lastT;
			if (dt > 0) p.velocity = (e.clientY - p.lastY) / dt;
			p.lastY = e.clientY;
			p.lastT = e.timeStamp;
			const delta = e.clientY - p.startY;
			if (Math.abs(delta) > 4) movedRef.current = true;
			const range = expandedHeight - SELECTION_SHEET_TEASER_HEIGHT;
			const clamped = expanded
				? delta < 0
					? rubberBand(delta)
					: Math.min(delta, range + rubberBand(Math.max(0, delta - range)))
				: delta > 0
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
		setDragOffset(null);
		setExpanded(
			resolveSheetSnap({
				expanded,
				delta: p.lastY - p.startY,
				velocity: p.velocity,
				expandedHeight,
				teaserHeight: SELECTION_SHEET_TEASER_HEIGHT,
			}),
		);
	}, [expanded, expandedHeight]);

	const collapsedTranslate = expandedHeight - SELECTION_SHEET_TEASER_HEIGHT;
	const baseTranslate = expanded ? 0 : collapsedTranslate;
	const dragging = dragOffset !== null;
	const translate = baseTranslate + (dragOffset ?? 0);
	const transition = dragging ? "none" : `transform ${SNAP_MS}ms ${SNAP_EASE}`;

	const defaultLabel = selectAll?.checked
		? `All ${formatCount(count)} loaded selected`
		: `${formatCount(count)} ${count === 1 ? "message" : "messages"} selected`;

	const showQuickActions = mode === "idle" || mode === "escalated";
	const showSmartRows = mode === "idle";

	return (
		<div
			ref={containerRef}
			data-selection-sheet=""
			className="absolute inset-x-0 bottom-0 z-30 flex select-none flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl shadow-black/40"
			style={{
				maxHeight: `min(${EXPANDED_MAX}px, 38dvh)`,
				minHeight: `${SELECTION_SHEET_TEASER_HEIGHT}px`,
				transform: `translateY(${translate}px)`,
				transition,
			}}
		>
			{/* Grabber / teaser — always visible at the peek. Tapping toggles the
			    snap state; dragging snaps between the two heights. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users reach every action via the buttons below; the grabber is a pointer-drag affordance */}
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
					// A drag already settled the snap in finishDrag; swallow the click
					// the browser fires after it so it doesn't toggle straight back.
					if (movedRef.current) {
						movedRef.current = false;
						return;
					}
					if (!dragging && !locked) setExpanded((v) => !v);
				}}
				className={cn(
					"flex touch-none flex-col items-center pt-2",
					locked ? "" : "cursor-grab active:cursor-grabbing",
				)}
			>
				<div className="mb-1.5 h-1 w-10 rounded-full bg-fg-subtle/40" />
				<div className="flex w-full items-center gap-2 px-4 pb-3">
					<span
						className="min-w-0 flex-1 truncate text-sm font-semibold text-fg"
						role="status"
						aria-live="polite"
					>
						{statusLabel ?? defaultLabel}
					</span>
					{expanded ? (
						<>
							{onMarkRead && !isBusy && mode !== "counting" && (
								<Button
									variant="ghost"
									size="touch"
									icon={<MailOpen className="size-4" />}
									onClick={(e) => {
										e.stopPropagation();
										onMarkRead();
									}}
									aria-label="Mark as read"
									className="-my-2 shrink-0"
								/>
							)}
							<Button
								variant="ghost"
								size="touch"
								icon={<X className="size-4" />}
								onClick={(e) => {
									e.stopPropagation();
									onCancel();
								}}
								aria-label="Cancel selection"
								className="-my-2 -mr-2 shrink-0"
							/>
						</>
					) : (
						<span className="flex shrink-0 items-center gap-1 text-xs text-fg-subtle">
							<span>Swipe up for actions</span>
							<ChevronUp className="size-4" />
						</span>
					)}
				</div>
			</div>

			{/* Expanded content — clipped by the translate when collapsed. */}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4">
				{progress && (
					<div className="mb-3">
						<ProgressBar
							value={progress.value}
							max={progress.max}
							tone={progress.tone}
						/>
					</div>
				)}

				{selectAll && mode !== "running" && (
					// biome-ignore lint/a11y/noLabelWithoutControl: the label wraps Checkbox's own input, giving the 20px control a 44px hit area
					<label className="mb-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-fg-muted">
						<Checkbox
							aria-label="Select all"
							checked={selectAll.checked}
							indeterminate={selectAll.indeterminate}
							onChange={selectAll.onChange}
						/>
						Select all loaded
					</label>
				)}

				{showQuickActions && (
					<div className="mb-3 flex items-stretch justify-around gap-1 border-b border-line pb-3">
						<Button
							variant="ghost"
							onClick={onDelete}
							icon={
								isBusy ? (
									<Loader2 className="size-5 animate-spin" />
								) : (
									<Trash2 className="size-5 text-danger" />
								)
							}
							aria-label="Move selected messages to Trash"
							aria-busy={isBusy || undefined}
							className="h-auto flex-1 flex-col gap-1 px-0 py-1.5 text-[11px]"
						>
							Delete
						</Button>
						{moveSlot && (
							<div className="flex flex-1 flex-col items-center gap-1">
								{moveSlot}
								<span aria-hidden="true" className="text-[11px] text-fg-muted">
									Move
								</span>
							</div>
						)}
						{onJunk && (
							<Button
								variant="ghost"
								onClick={onJunk}
								icon={<ShieldAlert className="size-5" />}
								aria-label="Move selected messages to Junk"
								className="h-auto flex-1 flex-col gap-1 px-0 py-1.5 text-[11px]"
							>
								Junk
							</Button>
						)}
					</div>
				)}

				{showSmartRows && (onSelectSimilar || onSomethingElse) && (
					<div className="flex flex-col gap-2">
						{onSelectSimilar && (
							<Button
								variant="primary"
								onClick={onSelectSimilar}
								className="h-auto flex-col items-start gap-0 px-4 py-2.5 text-left"
							>
								<span className="text-sm font-semibold leading-tight">
									Select similar messages
								</span>
								<span className="text-xs opacity-80">find more like these</span>
							</Button>
						)}
						{onSomethingElse && (
							<Button
								variant="secondary"
								onClick={onSomethingElse}
								className="h-auto flex-col items-start gap-0 px-4 py-2.5 text-left"
							>
								<span className="text-sm font-medium leading-tight">
									Something else
								</span>
								<span className="text-xs text-fg-subtle">
									just deal with these
								</span>
							</Button>
						)}
					</div>
				)}

				{notice && (
					<Banner
						tone={notice.tone}
						variant="soft"
						role="status"
						aria-live="polite"
						className={cn(showQuickActions || progress ? "mt-1" : "mt-0")}
					>
						<div className="flex items-center justify-between gap-2">
							{notice.text && <span>{notice.text}</span>}
							{notice.action && (
								<Button
									variant="ghost"
									size="md"
									onClick={notice.action.onClick}
									className="-my-1 min-h-11 shrink-0"
								>
									{notice.action.label}
								</Button>
							)}
						</div>
					</Banner>
				)}
			</div>
		</div>
	);
}
