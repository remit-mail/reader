import { useState } from "react";
import {
	type AppShellProps,
	type BriefCategoryFilter,
	type NarrowView,
	resolvePaneLayout,
	useContainerWidth,
} from "./app-shell-types.js";
import { Dialog } from "./dialog.js";
import { IntelligencePanel } from "./intelligence-panel.js";
import { MessageListPane } from "./message-list-pane.js";
import { MobileMessagePane } from "./mobile-message-pane.js";
import { NavSidebar } from "./nav-sidebar.js";
import { ReadingPane } from "./reading-pane.js";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "./resizable.js";

/* ------------------------------------------------------------------ */
/* Composite shell: composes the kit into the responsive 4-pane shell  */
/* (nav | list | reading | intelligence), collapsing by container      */
/* width down to a single pane.                                        */
/* ------------------------------------------------------------------ */

export function AppShell({
	accounts,
	initialWidth,
	selectedNavId,
	briefUnseen,
	listTitle,
	listMeta,
	chips,
	mutedNote,
	sections,
	briefFilters,
	flatList,
	listState,
	searchQuery,
	onRetry,
	onReportError,
	briefCategory,
	onSelectBriefCategory,
	selectedThreadId,
	thread,
	initialNarrowView = "list",
	initialTouchState,
	intelligence,
	intelligenceOpen = true,
	density,
	onSelectNav,
	onSelectThread,
	onToggleIntelligence,
}: AppShellProps) {
	/* The shell reflows by its OWN width (container query via ResizeObserver),
	   not the viewport — so it works embedded at any width. Before the first
	   measure (SSR / pre-mount) width is null and we render the narrowest
	   layout (list only). */
	const [containerRef, containerWidth] = useContainerWidth(initialWidth);
	const panes = resolvePaneLayout(containerWidth ?? 0);
	const showReadingPane = panes.reading;
	const isWide = panes.intelligence;
	/* Below the reading boundary the nav is not a persistent pane — it opens as
	   a dismissible slide-over from a folders button in the list header (#784).
	   At/above it the nav stays a persistent pane and this drawer state is unused. */
	const showNavPane = panes.nav;
	const [navOpen, setNavOpen] = useState(false);
	/* Below the reading boundary the single pane is the list or the message view;
	   above it the thread fills the reading pane and narrowView is unused. */
	const [narrowView, setNarrowView] = useState<NarrowView>(initialNarrowView);
	const showMessagePane =
		!showReadingPane && narrowView === "message" && Boolean(thread);
	const selectThread = (id: string) => {
		if (!showReadingPane) setNarrowView("message");
		onSelectThread?.(id);
	};
	const showIntelligence =
		isWide && Boolean(intelligence) && intelligenceOpen && Boolean(thread);
	/* Category lives here when uncontrolled so the brief and the nav expando
	   share one axis; a controlled `briefCategory`/`onSelectBriefCategory` pair
	   overrides it. */
	const [internalCategory, setInternalCategory] = useState<BriefCategoryFilter>(
		briefCategory ?? "all",
	);
	const activeCategory = briefCategory ?? internalCategory;
	const selectCategory = (category: BriefCategoryFilter) => {
		setInternalCategory(category);
		onSelectBriefCategory?.(category);
	};
	return (
		<div
			ref={containerRef}
			className="@container flex h-dvh w-full overflow-hidden bg-canvas font-sans text-fg"
		>
			{/* Resizable panes: drag handles ARE the hairlines between panes.
			    Sizes are percentages (library constraint) tuned to the old
			    fixed widths at ~1440px. Layout persistence (autoSaveId →
			    user preference storage) is future work, see README. */}
			<ResizablePanelGroup direction="horizontal">
				{showNavPane && (
					<>
						<ResizablePanel
							id="nav"
							order={1}
							defaultSize={17}
							minSize={12}
							maxSize={24}
							className="min-w-0"
						>
							<NavSidebar
								accounts={accounts}
								selectedNavId={selectedNavId}
								briefUnseen={briefUnseen}
								onSelectNav={onSelectNav}
							/>
						</ResizablePanel>
						<ResizableHandle />
					</>
				)}
				<ResizablePanel
					id="list"
					order={2}
					defaultSize={showReadingPane ? (density === "compact" ? 36 : 27) : 83}
					minSize={18}
					maxSize={showReadingPane ? 48 : 88}
					className="min-w-0"
				>
					{showMessagePane && thread ? (
						<MobileMessagePane
							thread={thread}
							intelligence={intelligence}
							onBack={() => setNarrowView("list")}
						/>
					) : (
						<MessageListPane
							listTitle={listTitle}
							listMeta={listMeta}
							chips={chips}
							mutedNote={mutedNote}
							sections={sections}
							briefFilters={briefFilters}
							flatList={flatList}
							listState={listState}
							searchQuery={searchQuery}
							onRetry={onRetry}
							onReportError={onReportError}
							briefCategory={activeCategory}
							selectedThreadId={selectedThreadId}
							density={density}
							onSelectThread={selectThread}
							onSelectBriefCategory={selectCategory}
							onOpenNav={showNavPane ? undefined : () => setNavOpen(true)}
							isDesktop={showReadingPane}
							initialTouchState={initialTouchState}
						/>
					)}
				</ResizablePanel>
				{showReadingPane && (
					<>
						<ResizableHandle />
						<ResizablePanel
							id="reading"
							order={3}
							minSize={24}
							className="min-w-0"
						>
							<ReadingPane
								thread={thread}
								intelligenceOpen={showIntelligence}
								onToggleIntelligence={onToggleIntelligence}
								showIntelligenceToggle={
									isWide && Boolean(intelligence) && Boolean(thread)
								}
							/>
						</ResizablePanel>
					</>
				)}
				{showIntelligence && intelligence && (
					<>
						<ResizableHandle />
						<ResizablePanel
							id="intelligence"
							order={4}
							defaultSize={21}
							minSize={15}
							maxSize={32}
							className="min-w-0"
						>
							<IntelligencePanel
								data={intelligence}
								onClose={onToggleIntelligence}
								className="h-full w-full border-l-0"
							/>
						</ResizablePanel>
					</>
				)}
			</ResizablePanelGroup>

			{/* Narrow widths: the nav is a dismissible slide-over (Dialog, anchor
			    left) opened from the list header's folders button — not a pane.
			    Selecting a destination closes it. Backdrop click + Escape dismiss. */}
			{!showNavPane && (
				<Dialog
					open={navOpen}
					onClose={() => setNavOpen(false)}
					title="Folders"
					anchor="left"
				>
					<NavSidebar
						accounts={accounts}
						selectedNavId={selectedNavId}
						briefUnseen={briefUnseen}
						onSelectNav={(id) => {
							onSelectNav?.(id);
							setNavOpen(false);
						}}
					/>
				</Dialog>
			)}
		</div>
	);
}
