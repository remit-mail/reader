import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import { Badge } from "./badge.js";

export type CategoryTone =
	| "neutral"
	| "accent"
	| "positive"
	| "warning"
	| "danger";

export interface FilterSheetCategory {
	id: string;
	label: string;
	tone?: CategoryTone;
}

export interface FilterSheetFilter {
	id: string;
	label: string;
}

export interface FilterSheetSource {
	id: string;
	label: string;
	count?: number;
	active?: boolean;
}

export interface FilterSheetProps {
	/** Available category options. The first one is treated as "all" (clears category). */
	categories: FilterSheetCategory[];
	/** Available attribute filters for multi-toggle. */
	filters: FilterSheetFilter[];
	/**
	 * Source/account pills. Single-select scoping the brief to one account.
	 * Omitted (or a single entry) hides the source row.
	 */
	sources?: FilterSheetSource[];
	/** Note rendered alongside the source pills (e.g. "+2 muted"). */
	sourcesNote?: string;
	/** Currently selected category id. */
	selectedCategory: string;
	/** Currently active filter ids. */
	activeFilters: ReadonlySet<string>;
	/**
	 * Whether the sheet is expanded.
	 * When omitted the component manages this state internally.
	 */
	expanded?: boolean;
	/** Called when the user selects a category. */
	onSelectCategory: (id: string) => void;
	/** Called when the user selects a source/account pill. */
	onSelectSource?: (id: string) => void;
	/** Called when the user toggles a filter on or off. */
	onToggleFilter: (id: string) => void;
	/** Called when the user clears all selections back to defaults. */
	onClear: () => void;
	/**
	 * Called when the expanded state changes.
	 * Required when `expanded` is a controlled prop.
	 */
	onExpandedChange?: (expanded: boolean) => void;
	/**
	 * Presentation. `"sheet"` (default) is the touch drag-snap overlay; `"popover"`
	 * is the desktop variant — a click-toggle Filters bar that expands an inline
	 * panel above the list (no drag chrome, no scrim). One source of truth for
	 * both breakpoints.
	 */
	variant?: "sheet" | "popover";
	/** Content the sheet overlays — the list behind does not reflow. */
	children?: React.ReactNode;
}

const SNAP_MS = 280;
const SNAP_EASE = "cubic-bezier(0.34, 1.4, 0.64, 1)";
const FLICK_VELOCITY = 0.5; // px/ms — flick commits regardless of distance
const SHEET_HEIGHT_FALLBACK = 168;

function rubberBand(overshoot: number): number {
	return Math.sign(overshoot) * Math.sqrt(Math.abs(overshoot)) * 4;
}

function ChevronDown({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 12 12"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden
		>
			<path d="M2 4l4 4 4-4" />
		</svg>
	);
}

function Close({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 12 12"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden
		>
			<path d="M3 3l6 6M9 3l-6 6" />
		</svg>
	);
}

export function FilterSheet({
	categories,
	filters,
	sources,
	sourcesNote,
	selectedCategory,
	activeFilters,
	expanded: expandedProp,
	onSelectCategory,
	onSelectSource,
	onToggleFilter,
	onClear,
	onExpandedChange,
	variant = "sheet",
	children,
}: FilterSheetProps) {
	const isControlled = expandedProp !== undefined;
	const [internalOpen, setInternalOpen] = useState(variant !== "popover");

	const open = isControlled ? expandedProp : internalOpen;

	const setOpen = useCallback(
		(next: boolean) => {
			if (!isControlled) setInternalOpen(next);
			onExpandedChange?.(next);
		},
		[isControlled, onExpandedChange],
	);

	const [drag, setDrag] = useState<number | null>(null);

	const sheetRef = useRef<HTMLDivElement>(null);
	const [sheetHeight, setSheetHeight] = useState(SHEET_HEIGHT_FALLBACK);

	useLayoutEffect(() => {
		const el = sheetRef.current;
		if (!el) return;
		const measure = () => setSheetHeight(el.offsetHeight);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const pointer = useRef<{
		startY: number;
		baseOffset: number;
		lastY: number;
		lastT: number;
		velocity: number;
		moved: boolean;
	} | null>(null);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			pointer.current = {
				startY: e.clientY,
				baseOffset: open ? 0 : -sheetHeight,
				lastY: e.clientY,
				lastT: e.timeStamp,
				velocity: 0,
				moved: false,
			};
			setDrag(open ? 0 : -sheetHeight);
		},
		[open, sheetHeight],
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
			if (Math.abs(delta) > 4) p.moved = true;

			let next = p.baseOffset + delta;
			if (next > 0) next = rubberBand(next);
			else if (next < -sheetHeight)
				next = -sheetHeight + rubberBand(next + sheetHeight);
			setDrag(next);
		},
		[sheetHeight],
	);

	const finishDrag = useCallback(() => {
		const p = pointer.current;
		pointer.current = null;
		if (!p) return;

		if (!p.moved) {
			setOpen(!open);
			setDrag(null);
			return;
		}

		const offset = p.baseOffset + (p.lastY - p.startY);
		const pastMid = offset > -sheetHeight / 2;
		const flick = Math.abs(p.velocity) > FLICK_VELOCITY;
		const commitOpen = flick ? p.velocity > 0 : pastMid;
		setOpen(commitOpen);
		setDrag(null);
	}, [open, setOpen, sheetHeight]);

	const keyToggle = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				setOpen(!open);
			}
		},
		[open, setOpen],
	);

	const defaultCategory = categories[0];
	const isDefault =
		defaultCategory !== undefined && selectedCategory === defaultCategory.id;

	const defaultSource = sources?.[0];
	const activeSource = sources?.find((s) => s.active);
	const isDefaultSource =
		defaultSource === undefined || activeSource?.id === defaultSource.id;

	const hasActive =
		!isDefault ||
		activeFilters.size > 0 ||
		(!isDefaultSource && !!activeSource);

	const clearSource = useCallback(() => {
		if (defaultSource) onSelectSource?.(defaultSource.id);
	}, [defaultSource, onSelectSource]);

	const clearAll = useCallback(() => {
		onClear();
		clearSource();
	}, [onClear, clearSource]);

	const dragging = drag !== null;
	const offset = drag ?? (open ? 0 : -sheetHeight);
	const openness = Math.min(
		Math.max((offset + sheetHeight) / sheetHeight, 0),
		1,
	);

	const sheetTransition = dragging
		? "none"
		: `transform ${SNAP_MS}ms ${SNAP_EASE}`;

	const activeCategory = categories.find((c) => c.id === selectedCategory);

	const summaryChips = hasActive ? (
		<>
			{!isDefaultSource && activeSource && (
				<span className="inline-flex items-center rounded-full border border-accent-2 bg-accent-2-soft px-2 py-0.5 text-2xs font-medium text-accent-2">
					{activeSource.label}
				</span>
			)}
			{!isDefault && activeCategory && (
				<Badge tone={activeCategory.tone ?? "neutral"}>
					{activeCategory.label}
				</Badge>
			)}
			{filters
				.filter((f) => activeFilters.has(f.id))
				.map((f) => (
					<span
						key={f.id}
						className="inline-flex items-center rounded-full border border-accent-2 bg-accent-2-soft px-2 py-0.5 text-2xs font-medium text-accent-2"
					>
						{f.label}
					</span>
				))}
		</>
	) : (
		<span className="text-2xs text-fg-subtle">Filters</span>
	);

	const sourceRow = sources && sources.length > 1 && (
		<div className="flex flex-wrap items-center gap-1.5 border-b border-line px-row-inset pb-2 pt-2">
			{sources.map((source) => (
				<button
					key={source.id}
					type="button"
					onClick={() => onSelectSource?.(source.id)}
					className={cn(
						"flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
						source.active
							? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
							: "border-line text-fg-muted hover:border-line-strong",
					)}
				>
					{source.label}
					{source.count != null && source.count > 0 && (
						<span className="tabular-nums opacity-70">{source.count}</span>
					)}
				</button>
			))}
			{sourcesNote && (
				<span className="ml-auto shrink-0 text-2xs text-fg-subtle">
					{sourcesNote}
				</span>
			)}
		</div>
	);

	const categoryRow = (
		<div className="flex flex-wrap items-center gap-1.5 border-b border-line px-row-inset pb-1.5 pt-1.5">
			{categories.map((cat) => {
				const selected = selectedCategory === cat.id;
				return (
					<button
						key={cat.id}
						type="button"
						onClick={() => onSelectCategory(cat.id)}
						className={cn(
							"shrink-0 rounded-full transition-opacity",
							selected
								? "opacity-100 ring-1 ring-accent-2"
								: "opacity-60 hover:opacity-100",
						)}
					>
						<Badge tone={cat.tone ?? "neutral"}>{cat.label}</Badge>
					</button>
				);
			})}
		</div>
	);

	const filterRow = (
		<div className="flex flex-wrap items-center gap-1.5 border-b border-line px-row-inset pb-2 pt-1.5">
			{filters.map((f) => {
				const on = activeFilters.has(f.id);
				return (
					<button
						key={f.id}
						type="button"
						onClick={() => onToggleFilter(f.id)}
						className={cn(
							"shrink-0 rounded-full border px-2.5 py-0.5 text-2xs transition-colors",
							on
								? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
								: "border-line text-fg-muted hover:border-line-strong",
						)}
					>
						{f.label}
					</button>
				);
			})}
			{hasActive && (
				<button
					type="button"
					onClick={clearAll}
					className="ml-auto flex items-center gap-1 px-1 text-2xs text-fg-subtle hover:text-fg-muted"
				>
					<Close className="size-3" />
					Clear
				</button>
			)}
		</div>
	);

	if (variant === "popover") {
		return (
			<div className="flex h-full w-full flex-col overflow-hidden">
				{/* The toggle is a div-button (not a real <button>) so the Clear
				    control can be a real nested <button> without invalid
				    button-in-button nesting — mirrors the sheet variant below. */}
				<div
					role="button"
					tabIndex={0}
					aria-expanded={open}
					aria-label={open ? "Collapse filters" : "Expand filters"}
					onClick={() => setOpen(!open)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							setOpen(!open);
						}
					}}
					className="flex h-section-row w-full shrink-0 cursor-pointer items-center gap-1.5 overflow-x-hidden border-b border-line bg-surface-sunken px-row-inset text-left hover:bg-surface"
				>
					{summaryChips}
					{hasActive && (
						<button
							type="button"
							aria-label="Clear filters"
							onClick={(e) => {
								e.stopPropagation();
								clearAll();
							}}
							className="flex size-6 items-center justify-center text-fg-subtle hover:text-fg-muted"
						>
							<Close className="size-3" />
						</button>
					)}
					<ChevronDown
						className={cn(
							"ml-auto size-3 shrink-0 text-fg-subtle transition-transform duration-200",
							open ? "rotate-180" : "rotate-0",
						)}
					/>
				</div>
				{open && (
					<div className="shrink-0">
						{sourceRow}
						{categoryRow}
						{filterRow}
					</div>
				)}
				<div className="flex-1 overflow-y-auto">{children}</div>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full select-none flex-col overflow-hidden">
			<div
				role="button"
				tabIndex={0}
				aria-expanded={open}
				aria-label={open ? "Collapse filters" : "Expand filters"}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={finishDrag}
				onPointerCancel={finishDrag}
				onKeyDown={keyToggle}
				className="z-30 flex h-section-row w-full shrink-0 cursor-pointer touch-none items-center gap-1.5 border-b border-line bg-surface-sunken px-row-inset text-left overflow-x-hidden"
			>
				{hasActive ? (
					<>
						{!isDefaultSource && activeSource && (
							<span className="inline-flex items-center rounded-full border border-accent-2 bg-accent-2-soft px-2 py-0.5 text-2xs font-medium text-accent-2">
								{activeSource.label}
							</span>
						)}
						{!isDefault && activeCategory && (
							<Badge tone={activeCategory.tone ?? "neutral"}>
								{activeCategory.label}
							</Badge>
						)}
						{filters
							.filter((f) => activeFilters.has(f.id))
							.map((f) => (
								<span
									key={f.id}
									className="inline-flex items-center rounded-full border border-accent-2 bg-accent-2-soft px-2 py-0.5 text-2xs font-medium text-accent-2"
								>
									{f.label}
								</span>
							))}
						<button
							type="button"
							aria-label="Clear filters"
							onPointerDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								clearAll();
							}}
							className="flex size-8 items-center justify-center text-fg-subtle hover:text-fg-muted"
						>
							<Close className="size-3" />
						</button>
					</>
				) : (
					<span className="text-2xs text-fg-subtle">Filters</span>
				)}
				<ChevronDown
					className={cn(
						"ml-auto size-3 shrink-0 text-fg-subtle transition-transform duration-200",
						open ? "rotate-180" : "rotate-0",
					)}
				/>
			</div>

			<div className="relative flex-1 overflow-hidden">
				<div className="h-full overflow-y-auto">{children}</div>

				<button
					type="button"
					aria-hidden={!open && !dragging}
					tabIndex={-1}
					onClick={() => setOpen(false)}
					className={cn(
						"absolute inset-0 z-10 bg-black/40",
						openness > 0 ? "pointer-events-auto" : "pointer-events-none",
					)}
					style={{
						opacity: openness * 0.6,
						transition: sheetTransition.replace("transform", "opacity"),
					}}
				/>

				<div
					ref={sheetRef}
					className="absolute inset-x-0 top-0 z-20 rounded-b-2xl border-b border-line bg-surface shadow-lg shadow-black/20"
					style={{
						transform: `translateY(${offset}px)`,
						transition: sheetTransition,
					}}
				>
					{sources && sources.length > 1 && (
						<div className="flex flex-wrap items-center gap-1.5 border-b border-line px-row-inset pb-3 pt-3">
							{sources.map((source) => (
								<button
									key={source.id}
									type="button"
									onClick={() => onSelectSource?.(source.id)}
									className={cn(
										"flex min-h-9 items-center gap-1 rounded-full border px-3.5 text-2xs transition-colors",
										source.active
											? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
											: "border-line text-fg-muted hover:border-line-strong",
									)}
								>
									{source.label}
									{source.count != null && source.count > 0 && (
										<span className="tabular-nums opacity-70">
											{source.count}
										</span>
									)}
								</button>
							))}
							{sourcesNote && (
								<span className="ml-auto shrink-0 text-2xs text-fg-subtle">
									{sourcesNote}
								</span>
							)}
							{!isDefaultSource && (
								<button
									type="button"
									aria-label="Clear source"
									onClick={clearSource}
									className={cn(
										"flex min-h-9 items-center gap-1 px-1 text-2xs text-fg-subtle hover:text-fg-muted",
										sourcesNote ? "" : "ml-auto",
									)}
								>
									<Close className="size-3" />
									Clear
								</button>
							)}
						</div>
					)}

					<div className="flex flex-wrap gap-2 px-row-inset pb-1 pt-3">
						{categories.map((cat) => {
							const selected = selectedCategory === cat.id;
							return (
								<button
									key={cat.id}
									type="button"
									onClick={() => onSelectCategory(cat.id)}
									className={cn(
										"flex min-h-9 items-center rounded-full px-1 transition-opacity",
										selected
											? "opacity-100 ring-1 ring-accent-2"
											: "opacity-60 hover:opacity-100",
									)}
								>
									<Badge tone={cat.tone ?? "neutral"}>{cat.label}</Badge>
								</button>
							);
						})}
						{hasActive && (
							<button
								type="button"
								onClick={onClear}
								className="ml-auto flex min-h-9 items-center gap-1 px-1 text-2xs text-fg-subtle hover:text-fg-muted"
							>
								<Close className="size-3" />
								Clear
							</button>
						)}
					</div>

					<div className="flex flex-wrap gap-2 px-row-inset pb-3 pt-2">
						{filters.map((f) => {
							const on = activeFilters.has(f.id);
							return (
								<button
									key={f.id}
									type="button"
									onClick={() => onToggleFilter(f.id)}
									className={cn(
										"flex min-h-9 items-center rounded-full border px-3.5 text-2xs transition-colors",
										on
											? "border-accent-2 bg-accent-2-soft font-medium text-accent-2"
											: "border-line text-fg-muted hover:border-line-strong",
									)}
								>
									{f.label}
								</button>
							);
						})}
					</div>

					<div
						role="slider"
						aria-label="Drag to open or close filters"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(openness * 100)}
						tabIndex={0}
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={finishDrag}
						onPointerCancel={finishDrag}
						onKeyDown={keyToggle}
						className="flex cursor-grab touch-none items-center justify-center py-2 active:cursor-grabbing"
					>
						<div className="h-1 w-10 rounded-full bg-fg-subtle/40" />
					</div>
				</div>
			</div>
		</div>
	);
}
