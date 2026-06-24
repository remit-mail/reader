import type { Decorator, Meta, StoryObj } from "@storybook/react";
import type { AccountChip, ThreadSection } from "./app-shell-types.js";
import { MessageListPane } from "./message-list-pane.js";
import { SelectionTopBar } from "./selection-top-bar.js";

const sections: ThreadSection[] = [
	{
		id: "today",
		label: "Today",
		threads: [
			{
				id: "t1",
				accountId: "a1",
				fromName: "Alex Rivera",
				fromEmail: "alex@example.com",
				subject: "Q3 planning notes",
				snippet: "Here are the notes from today's planning session.",
				timeLabel: "9:42",
				category: "personal",
			},
			{
				id: "t2",
				accountId: "a1",
				fromName: "Acme Billing",
				fromEmail: "billing@acme.com",
				subject: "Your invoice is ready",
				snippet: "Invoice #1042 is available to view.",
				timeLabel: "8:15",
				isRead: true,
				category: "transactional",
			},
		],
	},
	{
		id: "earlier",
		label: "Earlier",
		threads: [
			{
				id: "t3",
				accountId: "a1",
				fromName: "Weekly Digest",
				fromEmail: "news@digest.com",
				subject: "This week in tech",
				snippet: "The top stories you might have missed.",
				timeLabel: "Mon",
				category: "newsletter",
				messageCount: 3,
			},
		],
	},
];

const chips: AccountChip[] = [
	{ id: "all", label: "All", active: true },
	{ id: "work", label: "Work", count: 2 },
];

const meta: Meta<typeof MessageListPane> = {
	title: "Screens/Kit/MessageListPane",
	component: MessageListPane,
	parameters: { layout: "centered" },
	args: {
		listTitle: "Inbox",
		listMeta: "3 conversations",
		sections,
		onSelectThread: () => undefined,
		onSelectBriefCategory: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof MessageListPane>;

const desktopFrame: Decorator = (Story) => (
	<div className="h-screen w-96 overflow-hidden border border-line">
		<Story />
	</div>
);

const narrowFrame: Decorator = (Story) => (
	<div
		className="overflow-hidden border border-line"
		style={{ width: 390, height: 844 }}
	>
		<Story />
	</div>
);

export const DesktopList: Story = {
	args: { isDesktop: true, flatList: true },
	decorators: [desktopFrame],
};

export const NarrowTouchList: Story = {
	args: { isDesktop: false, flatList: true },
	decorators: [narrowFrame],
};

export const Brief: Story = {
	args: { isDesktop: true, briefFilters: true, sections, chips },
	decorators: [desktopFrame],
};

/** Consumer-supplied `listBody` slot — the pane renders the chrome (header,
 *  keyboard hints) while the caller owns the scrollable rows. This models
 *  the web-client's virtualized inbox path. */
export const CustomListBody: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		listBody: (
			<div className="flex-1 overflow-y-auto divide-y divide-line">
				{sections.flatMap((s) =>
					s.threads.map((t) => (
						<a
							key={t.id}
							href={`?selectedMessageId=${t.id}`}
							className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken"
						>
							<span className="font-medium text-sm">{t.fromName}</span>
							<span className="text-sm text-fg-muted truncate">
								{t.subject}
							</span>
						</a>
					)),
				)}
			</div>
		),
	},
	decorators: [desktopFrame],
};

/** External `selectionBar` slot — the pane delegates the header to the caller
 *  when a selection is active. */
export const ExternalSelectionBar: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		selectionBar: (
			<SelectionTopBar
				count={2}
				onCancel={() => undefined}
				onMarkRead={() => undefined}
				onDelete={() => undefined}
			/>
		),
	},
	decorators: [desktopFrame],
};

/** Fail-loud error state — the specific failure detail is surfaced under the
 *  headline (not a bare "something went wrong"), with a way back (Retry) and a
 *  place for the failure to go (Report a problem). */
export const ErrorState: Story = {
	args: {
		isDesktop: true,
		flatList: true,
		listState: "error",
		errorMessage: "Request timed out while loading this mailbox.",
		onRetry: () => undefined,
		onReportError: () => undefined,
	},
	decorators: [desktopFrame],
};
