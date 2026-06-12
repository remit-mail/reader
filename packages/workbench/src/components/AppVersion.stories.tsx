import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Inline version of the AppVersion component — mirrors the web-client
 * implementation exactly but without the build-time constants so it
 * can run in Storybook without the vite `define` plugin.
 */

interface AppVersionProps {
	sha?: string;
	commitUrl?: string;
	buildTime?: string;
}

function formatBuildTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

function AppVersion({
	sha = "abcdef1",
	commitUrl = "https://github.com/remit-mail/remit/commit/abcdef1234567890",
	buildTime = new Date().toISOString(),
}: AppVersionProps) {
	return (
		<p className="text-xs text-fg-subtle">
			Version{" "}
			<a
				href={commitUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="font-mono hover:text-fg-muted hover:underline"
			>
				{sha}
			</a>
			{" · "}
			<span>Built {formatBuildTime(buildTime)}</span>
		</p>
	);
}

const meta: Meta<AppVersionProps> = {
	title: "Components/AppVersion",
	component: AppVersion,
	parameters: { layout: "padded" },
	argTypes: {
		sha: { control: "text" },
		commitUrl: { control: "text" },
		buildTime: { control: "text" },
	},
};
export default meta;

type Story = StoryObj<AppVersionProps>;

/** Default: shows the short SHA as a link plus a human-readable build time. */
export const Default: Story = {
	args: {
		sha: "a1b2c3d",
		commitUrl: "https://github.com/remit-mail/remit/commit/a1b2c3d4e5f6",
		buildTime: "2024-06-12T10:30:00.000Z",
	},
};

/** Dev build: SHA is "dev" and commit URL points at the repo root. */
export const DevBuild: Story = {
	args: {
		sha: "dev",
		commitUrl: "https://github.com/remit-mail/remit",
		buildTime: new Date().toISOString(),
	},
};

/** As rendered inside Settings › Advanced — padded section with heading. */
export const InSettingsAboutSection: Story = {
	render: (args) => (
		<div className="border-t border-line pt-4 mt-4 max-w-sm">
			<p className="text-sm font-medium text-fg mb-1">About</p>
			<AppVersion {...args} />
		</div>
	),
	args: {
		sha: "a1b2c3d",
		commitUrl: "https://github.com/remit-mail/remit/commit/a1b2c3d4e5f6",
		buildTime: "2024-06-12T10:30:00.000Z",
	},
};
