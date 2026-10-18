import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MessageReportDialog } from "./message-report-dialog.js";
import { syncWarningDemoEntries } from "./sync-warning-fixtures.js";
import {
	formatSyncWarningReport,
	type SyncWarningEntry,
} from "./sync-warning-report.js";
import { SyncWarningRow } from "./sync-warning-row.js";
import { SyncWarningSection } from "./sync-warning-section.js";

const [gaveUp, retrying] = syncWarningDemoEntries;

const demoIssueUrl = "https://github.com/remit-mail/reader/issues/new";

const meta: Meta<typeof SyncWarningSection> = {
	title: "Design System/Settings/Sync warnings",
	component: SyncWarningSection,
	parameters: { layout: "padded" },
	args: { onReport: () => {} },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-2xl">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof SyncWarningSection>;

export const Empty: Story = {
	args: { entries: [], total: 0 },
};

export const Mixed: Story = {
	args: {
		entries: syncWarningDemoEntries,
		total: syncWarningDemoEntries.length,
	},
};

export const OverCap: Story = {
	args: { entries: syncWarningDemoEntries, total: 4_812 },
};

export const GaveUpRow: Story = {
	render: () => (
		<ul className="rounded-sm border border-line bg-surface">
			<SyncWarningRow entry={gaveUp} onReport={() => {}} />
		</ul>
	),
};

export const RetryingRow: Story = {
	render: () => (
		<ul className="rounded-sm border border-line bg-surface">
			<SyncWarningRow entry={retrying} onReport={() => {}} />
		</ul>
	),
};

export const ReportFlow: Story = {
	render: () => {
		const [open, setOpen] = useState<SyncWarningEntry | null>(null);
		return (
			<>
				<SyncWarningSection
					entries={syncWarningDemoEntries}
					total={syncWarningDemoEntries.length}
					onReport={setOpen}
				/>
				<MessageReportDialog
					report={open ? formatSyncWarningReport(open) : null}
					issueUrl={demoIssueUrl}
					onClose={() => setOpen(null)}
					onCopy={() => setOpen(null)}
				/>
			</>
		);
	},
};

export const Report: Story = {
	render: () => (
		<MessageReportDialog
			report={formatSyncWarningReport(gaveUp)}
			issueUrl={demoIssueUrl}
			onClose={() => {}}
			onCopy={() => {}}
		/>
	),
};
