import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { QuarantineBugDialog } from "./quarantine-bug-dialog.js";
import { quarantineDemoEntries } from "./quarantine-fixtures.js";
import type { QuarantineEntry } from "./quarantine-report.js";
import { QuarantineSection } from "./quarantine-section.js";

const [unterminatedBoundary, unknownCharset, truncatedBody] =
	quarantineDemoEntries;

/**
 * Stands in for the app's shared bug-report helper, which owns the URL budget
 * and the repository constant.
 */
const demoIssueUrl = "https://github.com/remit-mail/reader/issues/new";

const meta: Meta<typeof QuarantineSection> = {
	title: "Settings/Quarantine",
	component: QuarantineSection,
	parameters: { layout: "padded" },
	args: { onCutBug: () => {} },
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-2xl">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof QuarantineSection>;

export const Empty: Story = {
	args: { entries: [] },
};

export const OneEntry: Story = {
	args: { entries: [unterminatedBoundary] },
};

export const AlertState: Story = {
	args: { entries: [unterminatedBoundary, unknownCharset, truncatedBody] },
};

export const CutABugFlow: Story = {
	render: () => {
		const [open, setOpen] = useState<QuarantineEntry | null>(null);
		const [copied, setCopied] = useState(false);
		return (
			<>
				<QuarantineSection entries={quarantineDemoEntries} onCutBug={setOpen} />
				{copied && <p className="mt-3 text-xs text-positive">Report copied.</p>}
				<QuarantineBugDialog
					entry={open}
					issueUrl={demoIssueUrl}
					onClose={() => setOpen(null)}
					onCopy={() => setCopied(true)}
				/>
			</>
		);
	},
};

export const BugReport: Story = {
	render: () => (
		<QuarantineBugDialog
			entry={unterminatedBoundary}
			issueUrl={demoIssueUrl}
			onClose={() => {}}
			onCopy={() => {}}
		/>
	),
};
