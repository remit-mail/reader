import { Avatar, cn, Input, Kbd, type ThreadRowData } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown, Search, ShieldAlert } from "lucide-react";
import { useState } from "react";
import {
	instantResults,
	type SemanticHit,
	searchQuery,
	semanticResults,
} from "../fixtures/workspace.js";

const meta: Meta = {
	title: "Flows/Search",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

function SectionLabel({ label, meta }: { label: string; meta?: string }) {
	return (
		<div className="flex items-baseline justify-between border-b border-line bg-surface-sunken px-row-inset py-1">
			<span className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				{label}
			</span>
			{meta && <span className="text-2xs text-fg-subtle">{meta}</span>}
		</div>
	);
}

function ResultRow({
	thread,
	chip,
	score,
}: {
	thread: ThreadRowData;
	chip?: string;
	score?: number;
}) {
	const unread = !thread.isRead;
	return (
		<button
			type="button"
			className="flex w-full items-start gap-3 px-row-inset py-2 text-left hover:bg-surface-sunken"
		>
			<Avatar name={thread.fromName} email={thread.fromEmail} size="sm" />
			<span className="min-w-0 flex-1">
				<span className="flex items-baseline justify-between gap-2">
					<span
						className={cn(
							"truncate text-sm",
							unread ? "font-semibold text-fg" : "font-medium text-fg-muted",
						)}
					>
						{thread.fromName}
					</span>
					<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
						{thread.timeLabel}
					</span>
				</span>
				<span className="flex items-center gap-1.5">
					<span
						className={cn(
							"truncate text-sm",
							unread ? "text-fg" : "text-fg-muted",
						)}
					>
						{thread.subject}
					</span>
					{thread.suspicious && (
						<ShieldAlert className="size-3.5 shrink-0 text-danger" />
					)}
				</span>
				<span className="flex items-center gap-1.5">
					<span className="line-clamp-1 min-w-0 flex-1 text-xs text-fg-subtle">
						{thread.snippet}
					</span>
					{chip && (
						<span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-px text-2xs text-fg-subtle">
							{chip}
						</span>
					)}
					{score != null && (
						<span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
							{score.toFixed(2)}
						</span>
					)}
				</span>
			</span>
		</button>
	);
}

/** Sections show the top N results; the rest sits behind an expando. */
const SECTION_LIMIT = 5;

function ExpandoRow({
	hiddenCount,
	expanded,
	onToggle,
}: {
	hiddenCount: number;
	expanded: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex w-full items-center gap-1.5 px-row-inset py-1 text-left text-2xs text-fg-muted hover:bg-surface-sunken hover:text-fg"
		>
			<ChevronDown
				className={cn(
					"size-3.5 transition-transform",
					expanded && "rotate-180",
				)}
			/>
			{expanded ? "Show fewer" : `Show all ${hiddenCount} matches`}
		</button>
	);
}

function ResultSection<T>({
	label,
	meta,
	items,
	startExpanded,
	renderRow,
}: {
	label: string;
	meta?: string;
	items: T[];
	startExpanded?: boolean;
	renderRow: (item: T) => React.ReactNode;
}) {
	const [expanded, setExpanded] = useState(Boolean(startExpanded));
	const visible = expanded ? items : items.slice(0, SECTION_LIMIT);
	return (
		<>
			<SectionLabel label={label} meta={meta} />
			<div className="divide-y divide-line">{visible.map(renderRow)}</div>
			{items.length > SECTION_LIMIT && (
				<ExpandoRow
					hiddenCount={items.length}
					expanded={expanded}
					onToggle={() => setExpanded((v) => !v)}
				/>
			)}
		</>
	);
}

function SearchResults({
	semanticDown,
	startExpanded,
}: {
	semanticDown?: boolean;
	startExpanded?: boolean;
}) {
	return (
		<div className="flex h-dvh w-full items-stretch justify-center bg-canvas font-sans text-fg">
			<section className="flex w-128 flex-col border-x border-line bg-surface">
				<header className="border-b border-line px-row-inset py-2">
					<Input
						icon={<Search className="size-4" />}
						defaultValue={searchQuery}
					/>
					<div className="mt-2 flex items-center gap-1.5 text-2xs">
						<span className="rounded-full border border-line px-2 py-0.5 text-fg-muted">
							is:unread ×
						</span>
						<span className="rounded-full border border-line px-2 py-0.5 text-fg-muted">
							account:personal ×
						</span>
						<span className="text-fg-subtle">
							try <code>from:</code> <code>has:attachment</code>{" "}
							<code>before:</code>
						</span>
					</div>
				</header>

				<div className="flex-1 overflow-y-auto">
					<ResultSection
						label="Matches"
						meta={`${instantResults.length}`}
						items={instantResults}
						startExpanded={startExpanded}
						renderRow={(t) => <ResultRow key={t.id} thread={t} />}
					/>

					{semanticDown ? (
						<div className="px-row-inset py-3 text-2xs text-fg-subtle">
							Semantic search unavailable — showing exact matches only.
						</div>
					) : (
						<ResultSection
							label="Similar meaning"
							meta="semantic"
							items={semanticResults}
							startExpanded={startExpanded}
							renderRow={(hit: SemanticHit) => (
								<ResultRow
									key={hit.thread.id}
									thread={hit.thread}
									chip={`matched: ${hit.matched}`}
									score={hit.score}
								/>
							)}
						/>
					)}
				</div>

				<footer className="flex items-center gap-2 border-t border-line px-row-inset py-1 text-2xs text-fg-subtle">
					<Kbd>j</Kbd>
					<Kbd>k</Kbd>
					<span>navigate</span>
					<Kbd>Enter</Kbd>
					<span>open</span>
					<Kbd>Esc</Kbd>
					<span>clear</span>
				</footer>
			</section>
		</div>
	);
}

/**
 * One field, two engines: instant header matches first, semantic hits
 * below with matched-chunk chips and relevance scores. Each section
 * shows its top 5 with a "Show all n matches" expando (click it live).
 */
export const Results: Story = {
	render: () => <SearchResults />,
};

/** Both sections expanded in place via the expando rows. */
export const ResultsExpanded: Story = {
	render: () => <SearchResults startExpanded />,
};

/** Semantic engine down: instant results stand alone with a quiet footnote. */
export const SemanticUnavailable: Story = {
	render: () => <SearchResults semanticDown />,
};
