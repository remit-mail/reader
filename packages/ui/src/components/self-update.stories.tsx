import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	demoLogsCommand,
	demoRelease,
	type SelfUpdateState,
} from "./self-update.js";
import { SelfUpdateConfirmDialog } from "./self-update-confirm-dialog.js";
import { SelfUpdateSection } from "./self-update-section.js";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const CURRENT = "0.9.3";

const meta: Meta<typeof SelfUpdateSection> = {
	title: "Settings/Self-update",
	component: SelfUpdateSection,
	parameters: { layout: "padded" },
	args: {
		now: NOW,
		onCheck: () => {},
		onInstall: () => {},
		onDismissResult: () => {},
	},
	decorators: [
		(Story) => (
			<div className="mx-auto max-w-2xl">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof SelfUpdateSection>;

const withState = (state: SelfUpdateState) => ({ state });

/**
 * The state this pane is in almost always. One line, no call to action, no
 * colour — running the latest version is not news.
 */
export const UpToDate: Story = {
	args: withState({
		status: "upToDate",
		version: CURRENT,
		checkedAt: NOW - 21 * 60_000,
	}),
};

export const Checking: Story = {
	args: withState({ status: "checking", version: CURRENT }),
};

/**
 * An update exists. It is stated — version, date, one line of what changes, a
 * link to the full notes — and then it waits. Nothing here follows the user
 * back to their mail.
 */
export const UpdateAvailable: Story = {
	args: withState({
		status: "available",
		version: CURRENT,
		release: demoRelease,
	}),
};

/**
 * Cannot reach the update source. This is not a failure of the running Remit
 * and does not dress itself up as one: it names the cause, says the installed
 * version keeps working, and offers the retry.
 */
export const CheckFailedOffline: Story = {
	args: withState({
		status: "checkFailed",
		version: CURRENT,
		reason: "No route to github.com — the server has no outbound network.",
		lastCheckedAt: NOW - 3 * 24 * 60 * 60_000,
	}),
};

/**
 * Back on a reachable server, on the new version. Dismissible, and gone for
 * good once dismissed.
 */
export const Succeeded: Story = {
	args: withState({
		status: "succeeded",
		version: demoRelease.version,
		previousVersion: CURRENT,
		releaseNotesUrl: demoRelease.releaseNotesUrl,
	}),
};

/**
 * The new version came up broken and the old one was restored on its own. It
 * says which version is running now, why the other failed in the server's own
 * words, and where the full log lives.
 */
export const RolledBack: Story = {
	args: withState({
		status: "rolledBack",
		version: CURRENT,
		attemptedVersion: demoRelease.version,
		reason:
			'migration 0042_add_thread_index failed: relation "threads" does not exist',
		logsCommand: demoLogsCommand,
	}),
};

/**
 * Consent. Reflects the three things the user will actually feel — the pause,
 * that mail is untouched, and the automatic way back — before anything is
 * replaced. "Not now" is always the easiest button to hit.
 */
export const ConfirmBeforeInstalling: Story = {
	render: () => (
		<SelfUpdateConfirmDialog
			open
			currentVersion={CURRENT}
			release={demoRelease}
			onClose={() => {}}
			onConfirm={() => {}}
		/>
	),
};

/**
 * Consent reached from the pane, and declined. The offer stays exactly where
 * it was; declining costs nothing and is not asked about again.
 */
export const ConsentFlow: Story = {
	render: () => {
		const [open, setOpen] = useState(false);
		const [confirmed, setConfirmed] = useState(false);
		return (
			<>
				<SelfUpdateSection
					now={NOW}
					state={{
						status: "available",
						version: CURRENT,
						release: demoRelease,
					}}
					onCheck={() => {}}
					onInstall={() => setOpen(true)}
				/>
				{confirmed && (
					<p className="mt-3 text-xs text-fg-subtle">
						Consent given — the app hands over to the blocking restart screen
						here.
					</p>
				)}
				<SelfUpdateConfirmDialog
					open={open}
					currentVersion={CURRENT}
					release={demoRelease}
					onClose={() => setOpen(false)}
					onConfirm={() => {
						setOpen(false);
						setConfirmed(true);
					}}
				/>
			</>
		);
	},
};

/**
 * Pressing "Check again" while a check is already running. The control is
 * never disabled — it no-ops and says why, per the UX tenets.
 */
export const PressingCheckWhileChecking: Story = {
	args: withState({ status: "checking", version: CURRENT }),
	play: async ({ canvasElement }) => {
		canvasElement.querySelector<HTMLButtonElement>("button")?.click();
	},
};
