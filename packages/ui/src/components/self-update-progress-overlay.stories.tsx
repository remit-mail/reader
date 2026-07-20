import type { Meta, StoryObj } from "@storybook/react-vite";
import { demoLogsCommand, demoRelease } from "./self-update.js";
import {
	SelfUpdateProgressOverlay,
	SelfUpdateUnreachableScreen,
} from "./self-update-progress-overlay.js";

const meta: Meta<typeof SelfUpdateProgressOverlay> = {
	title: "Settings/Self-update restart",
	component: SelfUpdateProgressOverlay,
	parameters: { layout: "fullscreen" },
	args: { target: demoRelease.version },
	decorators: [
		(Story) => (
			<div className="h-dvh w-full bg-canvas p-6">
				<p className="text-sm text-fg-subtle">
					Settings sits here. The overlay is fixed to the window, so this stays
					covered and out of tab order.
				</p>
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof SelfUpdateProgressOverlay>;

/**
 * The new version is being put in place; the running server has not gone away
 * yet.
 */
export const Preparing: Story = {
	args: { phase: "preparing", elapsedSeconds: 6 },
};

/** The server is going down. From here the page has nothing to talk to. */
export const Restarting: Story = {
	args: { phase: "restarting", elapsedSeconds: 24 },
};

/**
 * Polling for a server that is not answering yet. This is the normal middle of
 * an update, so it reads as waiting, not as failure.
 */
export const Reconnecting: Story = {
	args: { phase: "reconnecting", elapsedSeconds: 48 },
};

/**
 * Past the point where "about a minute" is still true. The copy stops making
 * that promise rather than repeating it.
 */
export const ReconnectingTakingLong: Story = {
	args: { phase: "reconnecting", elapsedSeconds: 200 },
};

/**
 * Long silence. The copy still describes only what the client can observe —
 * how long it has been quiet — and never what the server is doing about it.
 */
export const ReconnectingStillSilent: Story = {
	args: { phase: "reconnecting", elapsedSeconds: 300 },
};

/**
 * The server never came back. The client cannot see the rollback from here, so
 * it says what it knows and points at the machine that can answer.
 */
export const NeverCameBack: StoryObj<typeof SelfUpdateUnreachableScreen> = {
	render: () => (
		<SelfUpdateUnreachableScreen
			attemptedVersion={demoRelease.version}
			previousVersion="0.9.3"
			elapsedSeconds={420}
			logsCommand={demoLogsCommand}
			onRetryConnection={() => {}}
		/>
	),
};
