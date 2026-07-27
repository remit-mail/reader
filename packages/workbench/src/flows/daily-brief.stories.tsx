import {
	AppShell,
	type BriefCategoryFilter,
	BriefSection,
	ComfortableRow,
	defaultKeyboardHints,
	KeyboardHintBar,
	MailHeader,
	SELECTION_SHEET_TEASER_HEIGHT,
	SelectionSheet,
	SelectionTopBar,
	type ThreadRowData,
	type ThreadSection,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createContext, useContext, useMemo, useState } from "react";
import {
	briefSections,
	briefSectionsLong,
	briefUnseen,
	categoryDrivenBriefSections,
	navAccounts,
	workId,
} from "../fixtures/workspace.js";

const meta: Meta<typeof AppShell> = {
	title: "Flows/DailyBrief",
	component: AppShell,
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppShell>;

/**
 * The unified brief across accounts, one section per category: Flagged first,
 * then Personal, Transactional, Newsletter, Marketing, Social, Automated.
 * Account chips segment; the muted hobby account is excluded but keeps syncing
 * ("+1 muted").
 */
export const Default: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			sections={briefSections()}
		/>
	),
};

/**
 * Brief with the per-section 10 + "Show N more" expander and a composable filter
 * chip bar (Unread · Has attachment · From contacts · Today). The padded
 * Personal and Newsletter sections show their first 10 rows with an expander;
 * chips stack additively to narrow the visible threads.
 */
export const Filtered: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			sections={briefSectionsLong()}
			briefFilters
		/>
	),
};

/** Account chip applied: every section filtered to the work account. */
export const WorkOnly: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta="Work only"
			sections={briefSections(workId)}
		/>
	),
};

/**
 * Category sections in display order.
 *
 *  - Flagged: one starred item, pinned top
 *  - Personal: a READ personal email — read state is not a routing signal
 *  - Transactional: a READ receipt
 *  - Newsletter: a newsletter from a wellknown sender — trust no longer routes
 *  - Automated: a status notification
 */
export const CategoryDriven: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={3}
			listTitle="Daily brief"
			listMeta="3 unread"
			sections={categoryDrivenBriefSections()}
		/>
	),
};

/**
 * Nothing needs attention — the brief says so and stays out of the way.
 * Renders identically whether the inbox is genuinely empty or every
 * candidate sender is muted (issue #301): `sections` is empty either way,
 * and the brief carries no separate "all muted" state.
 */
export const CaughtUp: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={0}
			listTitle="Daily brief"
			listMeta="You're caught up"
			sections={[]}
		/>
	),
};

/**
 * Keyboard-hint bar — the discoverability footer at the bottom of the
 * message list. Desktop only in the live app (hidden on touch where
 * key hints are noise). Default hints: j/k navigate · m mute ·
 * ? all shortcuts.
 *
 * Design source of truth for this state. The bar is always the last
 * element in the list pane and uses `text-2xs text-fg-subtle` tokens
 * with `Kbd` chips separated by a top border.
 */
export const KeyboardHints: Story = {
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			sections={briefSections()}
		/>
	),
};

/**
 * Phone width (390 px): the keyboard-hint bar must NOT appear — key hints
 * are noise on a touch device. The message list fills the full height with
 * no footer strip at the bottom.
 */
export const KeyboardHintsPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => (
		<AppShell
			accounts={navAccounts}
			selectedNavId="brief"
			briefUnseen={briefUnseen}
			listTitle="Daily brief"
			listMeta={`${briefUnseen} unread`}
			sections={briefSections()}
		/>
	),
};

/**
 * The aggregate brief as the web client composes it: the MailHeader top row,
 * then the brief list body straight underneath.
 *
 * The list's filter control (categories + attribute chips + the accounts group)
 * is hidden — the brief is being tried without it — so this screen renders the
 * kit `BriefSection`s directly rather than wrapping them in `BriefSections`,
 * which owns that control. The category scope still flattens the list to a
 * headerless one when it is narrowed; the phone search takeover is what sets it.
 * The control itself is still covered by the kit's own `BriefSections` stories.
 * Fast account switching is the nav sidebar, so there is no header chip row.
 */
function BriefScreen({
	initialCategory = "all",
}: {
	initialCategory?: BriefCategoryFilter;
}) {
	const [searchValue, setSearchValue] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [category] = useState<BriefCategoryFilter>(initialCategory);
	const sections = briefSections();
	const flatRows = sections
		.flatMap((section) => section.threads)
		.filter((thread) => thread.category === category);

	return (
		<div
			className="flex h-[760px] flex-col overflow-hidden border border-line bg-canvas"
			style={{ width: 390 }}
		>
			<MailHeader
				title="Daily brief"
				unreadCount={briefUnseen}
				isDesktop={false}
				onMenuClick={() => undefined}
				searchValue={searchValue}
				onSearchChange={setSearchValue}
				searchOpen={searchOpen}
				onSearchOpenChange={setSearchOpen}
			/>
			<div className="min-h-0 flex-1">
				<div className="h-full overflow-y-auto">
					{category === "all" ? (
						sections.map((section) => (
							<BriefSection
								key={section.id}
								section={section}
								Row={ComfortableRow}
							/>
						))
					) : (
						<div className="divide-y divide-line">
							{flatRows.map((thread) => (
								<ComfortableRow key={thread.id} thread={thread} />
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * (a) "All" scope: header straight onto the brief, every category section
 * rendered with its header and no filter bar between them.
 */
export const WithFilter: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefScreen />,
};

/**
 * (b) Single-category scope: narrowed to Newsletter, the brief renders FLAT
 * with NO section header.
 */
export const FilteredToCategory: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefScreen initialCategory="newsletter" />,
};

/* ------------------------------------------------------------------ */
/* Multi-select                                                        */
/* ------------------------------------------------------------------ */

interface BriefChecked {
	checked: ReadonlySet<string>;
	toggle: (id: string) => void;
}

const BriefCheckedContext = createContext<BriefChecked>({
	checked: new Set<string>(),
	toggle: () => undefined,
});

/**
 * A brief row that reads its checked state from context — the same shape the
 * web client uses, where the row is handed the selection by the list's
 * interaction provider rather than by the section that renders it.
 */
function SelectableBriefRow({
	thread,
	active,
	onClick,
}: {
	thread: ThreadRowData;
	active?: boolean;
	onClick?: () => void;
}) {
	const { checked, toggle } = useContext(BriefCheckedContext);
	return (
		<ComfortableRow
			thread={thread}
			active={active}
			onClick={onClick}
			selection={{
				checked: checked.has(thread.id),
				alwaysVisible: true,
				onToggle: () => toggle(thread.id),
			}}
		/>
	);
}

/**
 * A shift-range that crosses a section boundary: the last row of the first
 * section through the first two of the next, in the order the rows are on
 * screen. Section membership is not part of the range — the visible row order
 * is.
 */
function crossSectionRange(sections: ThreadSection[]): string[] {
	const [first, second] = sections;
	const tail = first?.threads.at(-1)?.id;
	const head = second?.threads.slice(0, 2).map((t) => t.id) ?? [];
	return tail ? [tail, ...head] : head;
}

function BriefMultiSelectScreen({ touch = false }: { touch?: boolean }) {
	const [searchValue, setSearchValue] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const sections = useMemo(() => briefSections(), []);
	const [checked, setChecked] = useState<ReadonlySet<string>>(
		() => new Set(crossSectionRange(sections)),
	);
	const value = useMemo<BriefChecked>(
		() => ({
			checked,
			toggle: (id: string) =>
				setChecked((prev) => {
					const next = new Set(prev);
					if (!next.delete(id)) next.add(id);
					return next;
				}),
		}),
		[checked],
	);
	const clear = () => setChecked(new Set());

	return (
		<BriefCheckedContext.Provider value={value}>
			<div
				className="relative flex h-[760px] flex-col overflow-hidden border border-line bg-canvas"
				style={{ width: touch ? 390 : 420 }}
			>
				{touch ? (
					<MailHeader
						title="Daily brief"
						unreadCount={briefUnseen}
						isDesktop={false}
						onMenuClick={() => undefined}
						searchValue={searchValue}
						onSearchChange={setSearchValue}
						searchOpen={searchOpen}
						onSearchOpenChange={setSearchOpen}
					/>
				) : (
					<SelectionTopBar
						count={checked.size}
						onCancel={clear}
						onDelete={clear}
						onMarkRead={clear}
					/>
				)}
				<div
					className="min-h-0 flex-1"
					style={
						touch ? { paddingBottom: SELECTION_SHEET_TEASER_HEIGHT } : undefined
					}
				>
					<div className="h-full overflow-y-auto">
						{sections.map((section) => (
							<BriefSection
								key={section.id}
								section={section}
								Row={SelectableBriefRow}
							/>
						))}
					</div>
				</div>
				{touch && checked.size > 0 && (
					<SelectionSheet
						count={checked.size}
						onCancel={clear}
						onDelete={clear}
						onMarkRead={clear}
						onSelectSimilar={() => undefined}
						onSomethingElse={() => undefined}
					/>
				)}
			</div>
		</BriefCheckedContext.Provider>
	);
}

/**
 * Desktop multi-select on the brief. The bar takes the header's place for as
 * long as rows are selected — the same slot, verbs and copy the mailbox list
 * raises, because it is the same bar. (`SelectionTopBar` is the kit twin of the
 * web client's `SelectionToolbar`; the account-scoped Move and Apply-label
 * triggers need live folder data and are covered by the web client's own
 * `SelectionToolbar` stories.)
 *
 * The checked rows span two category sections: a range follows the rows in the
 * order they are on screen, so it crosses a section header rather than stopping
 * at it.
 */
export const MultiSelect: Story = {
	parameters: { layout: "centered" },
	render: () => <BriefMultiSelectScreen />,
};

/**
 * Touch multi-select on the brief: the header stays, and the peeking selection
 * sheet carries the verbs. It rises at two or more selected — a single row
 * enters selection mode (checkboxes on the rows) without taking over the
 * chrome. The list pads its own bottom by the teaser's height so no row hides
 * behind it.
 */
export const MultiSelectPhone: Story = {
	parameters: { layout: "centered" },
	globals: { viewport: { value: "mobile" } },
	render: () => <BriefMultiSelectScreen touch />,
};

/**
 * The `KeyboardHintBar` component in isolation — the same bar the brief
 * (and every other message-list pane) renders at the bottom on desktop.
 * Renders as a full-width footer strip; use inside a height-constrained
 * container to see the border and spacing in context.
 */
export const KeyboardHintBarStandalone: Story = {
	render: () => (
		<div className="flex h-dvh flex-col bg-surface">
			<div className="flex-1" />
			<KeyboardHintBar hints={defaultKeyboardHints} />
		</div>
	),
};
