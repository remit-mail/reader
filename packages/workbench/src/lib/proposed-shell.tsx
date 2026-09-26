import {
	AppShellSlotted,
	type AppShellSlottedProps,
	Avatar,
	ComposeFab,
	type IntelligenceCalendarSurface,
	type IntelligenceData,
	IntelligencePanel,
	type IntelligenceTabId,
	MessageListPane,
	NavSidebar,
	ReadingPane,
	RefreshButton,
	ShellTopBar,
	type ThreadData,
	type ThreadSection,
} from "@remit/ui";
import { type ReactNode, useState } from "react";
import { navAccounts } from "../fixtures/workspace.js";

const DESKTOP_MIN_WIDTH = 1024;

export interface ProposedShellProps {
	width?: number;
	selectedNavId?: string;
	calendarNav?: "hidden" | "shown";
	listTitle?: string;
	unreadCount?: number;
	sections?: ThreadSection[];
	list?: ReactNode;
	listBias?: AppShellSlottedProps["listBias"];
	readingPane?: "default" | "off";
	reading?: ReactNode;
	overlay?: ReactNode;
	thread?: ThreadData;
	selectedThreadId?: string;
	intelligence?: IntelligenceData;
	intelligenceTab?: IntelligenceTabId;
	calendar?: IntelligenceCalendarSurface;
	rail?: ReactNode;
}

function TopBar() {
	const [query, setQuery] = useState("");
	return (
		<ShellTopBar
			search={{
				value: query,
				scope: "global",
				onChange: setQuery,
				onClear: () => setQuery(""),
				onClearQuery: () => setQuery(""),
			}}
			onCompose={() => undefined}
			onReportBug={() => undefined}
			onOpenSettings={() => undefined}
			composeShortcut="c"
			refreshControl={
				<RefreshButton
					state="idle"
					label="Refresh all accounts"
					onRefresh={() => undefined}
				/>
			}
			account={
				<button type="button" aria-label="Account">
					<Avatar name="Matthijs" email="matthijs@example.com" size="sm" />
				</button>
			}
		/>
	);
}

export function ProposedShell({
	width = 1440,
	selectedNavId = "brief",
	calendarNav = "hidden",
	listTitle = "Daily brief",
	unreadCount = 0,
	sections = [],
	list,
	listBias,
	readingPane = "default",
	reading,
	overlay,
	thread,
	selectedThreadId,
	intelligence,
	intelligenceTab,
	calendar,
	rail,
}: ProposedShellProps) {
	const singlePane = width < DESKTOP_MIN_WIDTH;
	const [railOpen, setRailOpen] = useState(true);
	const [navOpen, setNavOpen] = useState(false);

	const listPane = list ?? (
		<div className="flex h-full w-full flex-col bg-surface">
			<div className="min-h-0 flex-1">
				<MessageListPane
					listTitle={listTitle}
					listMeta={`${unreadCount.toLocaleString()} unread`}
					sections={sections}
					flatList
					selectedThreadId={selectedThreadId}
					isDesktop={!singlePane}
				/>
			</div>
		</div>
	);

	return (
		<AppShellSlotted
			initialWidth={width}
			nav={
				<NavSidebar
					accounts={navAccounts}
					selectedNavId={selectedNavId}
					briefUnseen={unreadCount}
					calendarNav={calendarNav}
				/>
			}
			topBar={singlePane ? undefined : <TopBar />}
			list={listPane}
			listBias={listBias}
			reading={
				singlePane || readingPane === "off"
					? undefined
					: (reading ?? (
							<ReadingPane
								thread={thread}
								intelligenceOpen={railOpen}
								canToggleIntelligence={Boolean(thread && intelligence)}
								onToggleIntelligence={() => setRailOpen((open) => !open)}
							/>
						))
			}
			intelligence={
				intelligence ? (
					<IntelligencePanel
						data={intelligence}
						calendar={calendar}
						defaultTab={intelligenceTab}
						onClose={() => setRailOpen(false)}
						touch={singlePane}
						className="h-full w-full border-l-0"
					/>
				) : (
					rail
				)
			}
			intelligenceOpen={railOpen}
			hasThread={Boolean(thread ?? rail)}
			overlay={
				overlay ??
				(singlePane ? <ComposeFab onCompose={() => undefined} /> : undefined)
			}
			navOpen={navOpen}
			onOpenNav={() => setNavOpen(true)}
			onCloseNav={() => setNavOpen(false)}
		/>
	);
}
