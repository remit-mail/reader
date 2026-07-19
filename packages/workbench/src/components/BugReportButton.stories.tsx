import { Button } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bug } from "lucide-react";

/**
 * Bug-report button — matches the web-client BugReportButton exactly.
 * In Storybook, the click handler logs the URL to the console so you
 * can inspect the prefilled issue body without opening GitHub.
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
		<Button
			variant="ghost"
			size="sm"
			icon={<Bug className="size-4" />}
			title="Report a bug"
			aria-label="Report a bug"
			onClick={handleClick}
		/>
	);
}

const meta: Meta = {
	title: "Components/BugReportButton",
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj;

/** Standalone button — click logs the prefilled URL to the console. */
export const Default: Story = {
	render: () => <BugReportButtonDemo />,
};

/** As it appears in the MessageToolbar — inline with other ghost icon buttons. */
export const InToolbarContext: Story = {
	render: () => (
		<header className="flex h-pane-header shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
			<div className="flex-1" />
			<Button
				variant="ghost"
				size="sm"
				icon={<Bug className="size-4" />}
				title="Compose"
				aria-label="Compose"
			/>
			<BugReportButtonDemo />
		</header>
	),
};
