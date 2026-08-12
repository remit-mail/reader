import { createContext, type ReactNode, useContext, useState } from "react";
import {
	type PaneLayout,
	resolvePaneLayout,
	useContainerWidth,
} from "./app-shell-types.js";
import { Dialog } from "./dialog.js";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
	WholePixelWidth,
} from "./resizable.js";

/* ------------------------------------------------------------------ */
/* Slot-based shell: the same responsive 4-pane arrangement as        */
/* AppShell but with ReactNode render slots instead of data props.     */
/* The web-client passes live data-bound children; the kit preview     */
/* passes its own static components via the data-driven AppShell.     */
/* ------------------------------------------------------------------ */

export interface AppShellSlottedProps {
	/**
	 * Nav sidebar content. Rendered as a persistent pane ≥1024px or as a
	 * dismissible slide-over below that. Required — the shell always has a nav.
	 */
	nav: ReactNode;
	/**
	 * List pane content: the message list, daily brief, outbox list, etc.
	 * Always visible at all widths (the single pane on narrow layouts).
	 */
	list: ReactNode;
	/**
	 * Reading pane content: the conversation view + toolbar. Appears ≥1024px.
	 * When absent the reading panel is not shown even if width allows.
	 */
	reading?: ReactNode;
	/**
	 * Intelligence rail content. Appears ≥1280px when `intelligenceOpen` is true.
	 * When absent the intelligence panel is not shown even if width allows.
	 */
	intelligence?: ReactNode;
	/** Show the intelligence pane (user preference). Defaults to true. */
	intelligenceOpen?: boolean;
	/**
	 * Guards the intelligence rail against showing with no open thread. The rail
	 * needs both width AND a thread; pass false to keep it closed even when wide
	 * and `intelligenceOpen` (an edge state). Defaults to true (caller asserts a
	 * thread, e.g. the live app only opens the rail with a selected message).
	 */
	hasThread?: boolean;
	/**
	 * List density. "compact" widens the list pane's default split (denser rows
	 * read better with more horizontal room); "comfortable" (default) uses the
	 * standard split. Only affects the two-pane (list + reading) default size.
	 */
	density?: "comfortable" | "compact";
	/**
	 * Which pane the two-pane split favours. "balanced" (default) is the mail
	 * arrangement, where the list is an index and the reading pane is the work.
	 * "list" is for a list pane that is itself the work — a calendar grid needs
	 * the width a week of columns costs, and cannot give it up when a detail
	 * opens. "detail" goes the other way for a list that is only a spine.
	 */
	listBias?: "list" | "balanced" | "detail";
	/**
	 * Header rendered only on narrow (< 1024px) widths — the mobile top bar.
	 * The web-client injects the app-specific bar (hamburger / title / search).
	 */
	header?: ReactNode;
	/**
	 * Row across the top of the shell, spanning the nav, list, reading and
	 * intelligence panes. Its full width is what makes the search field in it
	 * read as the app's search rather than the list's.
	 */
	topBar?: ReactNode;
	/**
	 * Content rendered outside the pane group (e.g., the compose FAB). Floats
	 * over the layout regardless of width.
	 */
	overlay?: ReactNode;
	/**
	 * Cold-load placeholder. Shown instead of the normal layout while `isLoading`
	 * is true.
	 */
	skeleton?: ReactNode;
	/** When true, shows `skeleton` instead of the panel layout. Defaults to false. */
	isLoading?: boolean;
	/**
	 * Seed width (px) for the container-query reflow before the first
	 * ResizeObserver measure (SSR / pre-mount).
	 */
	initialWidth?: number;
	/**
	 * Externally controlled nav-open state (narrow widths). When absent the
	 * shell manages it internally.
	 */
	navOpen?: boolean;
	/** Called when the nav slide-over should open. */
	onOpenNav?: () => void;
	/** Called when the nav slide-over should close. */
	onCloseNav?: () => void;
}

/* ------------------------------------------------------------------ */
/* Pane-layout context                                                  */
/* ------------------------------------------------------------------ */

/** Published by `AppShellSlotted`; consumed by `useAppShellLayout`. */
export interface AppShellLayoutContext {
	/** Current pane visibility derived from the shell's own-width. */
	panes: PaneLayout;
	/** Own-width in px; null before the first ResizeObserver measure. */
	containerWidth: number | null;
	/** True when the nav is a persistent pane (not a slide-over). */
	showNavPane: boolean;
	/** Open the nav slide-over. Call from list-header "folders" buttons. */
	openNav: () => void;
	/** True when the nav pane is collapsed away at a width that would show it. */
	navCollapsed: boolean;
	/**
	 * Show or hide the nav at whichever tier is current — it collapses the pane
	 * where the nav is a column and opens the slide-over where it is not, so one
	 * control in the top bar covers both.
	 */
	toggleNav: () => void;
	/** True when the reading pane is active (width ≥ 1024px). */
	showReadingPane: boolean;
	/** True when the intelligence rail can show (width ≥ 1280px). */
	showIntelligencePane: boolean;
}

const AppShellLayoutCtx = createContext<AppShellLayoutContext | null>(null);

/** The list panel's share of the two-pane group, and how far it may be dragged. */
function listShare(
	bias: NonNullable<AppShellSlottedProps["listBias"]>,
	density: NonNullable<AppShellSlottedProps["density"]>,
): { size: number; max: number } {
	if (bias === "list") return { size: 62, max: 78 };
	if (bias === "detail") return { size: 26, max: 45 };
	return { size: density === "compact" ? 43 : 33, max: 58 };
}

/**
 * Read the enclosing `AppShellSlotted`'s pane layout.
 * Returns null outside of an `AppShellSlotted` (tests / Storybook).
 */
export function useAppShellLayout(): AppShellLayoutContext | null {
	return useContext(AppShellLayoutCtx);
}

/* ------------------------------------------------------------------ */
/* AppShellSlotted                                                      */
/* ------------------------------------------------------------------ */

export function AppShellSlotted({
	nav,
	list,
	reading,
	intelligence,
	intelligenceOpen = true,
	hasThread = true,
	density = "comfortable",
	listBias = "balanced",
	header,
	topBar,
	overlay,
	skeleton,
	isLoading = false,
	initialWidth,
	navOpen: navOpenProp,
	onOpenNav,
	onCloseNav,
}: AppShellSlottedProps) {
	const [containerRef, containerWidth] = useContainerWidth(initialWidth);
	const panes = resolvePaneLayout(containerWidth ?? 0);
	const [navCollapsed, setNavCollapsed] = useState(false);
	// The tier, not the current visibility: consumers read it to decide whether
	// nav access is theirs to offer, and it stays the top bar's while collapsed.
	const showNavPane = panes.nav;
	const navPaneVisible = showNavPane && !navCollapsed;
	const showReadingPane = panes.reading && Boolean(reading);
	const isWide = panes.intelligence;

	const [navOpenInternal, setNavOpenInternal] = useState(false);
	const controlled = navOpenProp !== undefined;
	const navOpen = controlled ? navOpenProp : navOpenInternal;
	const openNav = () => {
		if (!controlled) setNavOpenInternal(true);
		onOpenNav?.();
	};
	const closeNav = () => {
		if (!controlled) setNavOpenInternal(false);
		onCloseNav?.();
	};

	const showIntelligencePanel =
		isWide && intelligenceOpen && hasThread && Boolean(intelligence);

	const toggleNav = () => {
		if (!showNavPane) {
			if (navOpen) closeNav();
			else openNav();
			return;
		}
		setNavCollapsed((collapsed) => !collapsed);
	};

	const layoutCtx: AppShellLayoutContext = {
		panes,
		containerWidth,
		showNavPane,
		openNav,
		navCollapsed,
		toggleNav,
		showReadingPane,
		showIntelligencePane: isWide,
	};

	/* Sizes are percentages of the group they sit in. This group excludes the nav
	   column, so they are shares of the remaining ~83%, not of the whole shell. */
	const share = listShare(listBias, density);
	const contentPanes = (
		<ResizablePanelGroup
			direction="horizontal"
			className="min-h-0 flex-1"
			/* A group whose panels come and go under it throws "previous layout not
			   found for panel index -1", and a panel already registered keeps the
			   layout it was given rather than the default it is handed next. Keying
			   on the set makes each arrangement its own group. */
			key={showReadingPane ? "list-reading" : "list-only"}
		>
			<ResizablePanel
				id="list"
				order={1}
				defaultSize={showReadingPane ? share.size : 100}
				minSize={22}
				maxSize={showReadingPane ? share.max : 100}
				className="min-w-0"
			>
				{list}
			</ResizablePanel>

			{showReadingPane && (
				<>
					<ResizableHandle />
					<ResizablePanel
						id="reading"
						order={2}
						minSize={29}
						className="min-w-0"
					>
						{/* The email inside this pane is laid out against the pane's own
						    width, so the pane is the last place a fractional box is
						    allowed. */}
						<WholePixelWidth className="h-full">{reading}</WholePixelWidth>
					</ResizablePanel>
				</>
			)}

			{showIntelligencePanel && (
				<>
					<ResizableHandle />
					<ResizablePanel
						id="intelligence"
						order={3}
						defaultSize={25}
						minSize={18}
						maxSize={39}
						className="min-w-0"
					>
						{intelligence}
					</ResizablePanel>
				</>
			)}
		</ResizablePanelGroup>
	);

	const content = (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			{/* Narrow top bar: rendered only when the nav is a slide-over
			    (< 1024px). Desktop has no slim bar. */}
			{!showNavPane && header && <div className="shrink-0">{header}</div>}

			{contentPanes}
		</div>
	);

	return (
		<AppShellLayoutCtx.Provider value={layoutCtx}>
			<div
				ref={containerRef}
				className="safe-area-frame @container flex h-dvh w-full flex-col overflow-hidden bg-canvas font-sans text-fg"
			>
				{isLoading && skeleton ? (
					skeleton
				) : (
					<>
						{topBar}

						{navPaneVisible ? (
							<ResizablePanelGroup
								direction="horizontal"
								className="min-h-0 flex-1"
							>
								<ResizablePanel
									id="nav"
									order={1}
									defaultSize={17}
									minSize={12}
									maxSize={24}
									className="min-w-0"
								>
									{nav}
								</ResizablePanel>
								<ResizableHandle />
								<ResizablePanel
									id="content"
									order={2}
									className="flex min-w-0 flex-col"
								>
									{content}
								</ResizablePanel>
							</ResizablePanelGroup>
						) : (
							content
						)}

						{/* Narrow nav: dismissible slide-over (#784). */}
						{!showNavPane && (
							<Dialog
								open={navOpen}
								onClose={closeNav}
								title="Folders"
								anchor="left"
							>
								{nav}
							</Dialog>
						)}

						{overlay}
					</>
				)}
			</div>
		</AppShellLayoutCtx.Provider>
	);
}
