import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bug, Settings } from "lucide-react";

/**
 * The bug-report row as the web-client renders it. The real component reaches
 * for build-time constants Storybook does not inject, so the click here logs
 * the prefilled issue URL to the console instead of opening GitHub.
 */

function buildIssueBody(): string {
	const sha = "a1b2c3d4e5f6";
	const shortSha = "a1b2c3d";
	const buildTime = "2024-06-12T10:30:00.000Z";

	return [
		"## Environment",
		`- **Version**: [\`${shortSha}\`](https://github.com/remit-mail/reader/commit/${sha}) built ${buildTime}`,
		`- **Browser**: ${navigator.userAgent}`,
		`- **Viewport**: ${window.innerWidth}×${window.innerHeight}`,
		`- **Time**: ${new Date().toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
		"",
		"## URL",
		window.location.href,
		"",
		"## Recent console errors",
		"  (none)",
		"",
		"## Steps to reproduce",
		"1. ",
		"",
		"## Expected behaviour",
		"",
		"## Actual behaviour",
		"",
	].join("\n");
}

function BugReportButtonDemo() {
	const handleClick = () => {
		const body = buildIssueBody();
		const params = new URLSearchParams({ title: "Bug: ", body });
		const url = `https://github.com/remit-mail/reader/issues/new?${params.toString()}`;
		console.info("[BugReportButton] Would open:", url);
		alert("Bug report URL logged to the Storybook console (Actions tab).");
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
		>
			<Bug className="size-4 shrink-0" />
			<span className="flex-1 truncate text-left">Report a bug</span>
		</button>
	);
}

const meta: Meta = {
	title: "Components/BugReportButton",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

/** Standalone row — click logs the prefilled URL to the console. */
export const Default: Story = {
	render: () => (
		<div className="w-64">
			<BugReportButtonDemo />
		</div>
	),
};

/** Where it lives: the nav drawer's footer, under Settings. */
export const InDrawerFooter: Story = {
	render: () => (
		<div className="w-64 space-y-0.5 border-t border-line bg-canvas p-2">
			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg"
			>
				<Settings className="size-4 shrink-0" />
				<span className="flex-1 truncate text-left">Settings</span>
			</button>
			<BugReportButtonDemo />
		</div>
	),
};
