import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	demoLogsCommand,
	demoRelease,
	demoRunId,
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
 * Pressing check while the previous answer was "up to date". The pane keeps
 * saying so while the new answer is in flight, rather than blanking to a bare
 * spinner (issue #599).
 */
export const CheckingWithPreviousUpToDate: Story = {
	args: withState({
		status: "checking",
		version: CURRENT,
		previous: { kind: "upToDate", checkedAt: NOW - 21 * 60_000 },
	}),
};

/**
 * Pressing check again after an update was already found. The offer stays
 * visible under the spinner instead of disappearing while the re-check runs.
 */
export const CheckingWithPreviousAvailable: Story = {
	args: withState({
		status: "checking",
		version: CURRENT,
		previous: { kind: "available", release: demoRelease },
	}),
};

/**
 * A fresh, configured instance before its first automatic check has landed. The
 * honest resting state, not a spinner: it says a check has not run and that Remit
 * checks on its own, and offers a manual check. This is what every install shows
 * until the updater writes its first result.
 */
export const NeverChecked: Story = {
	args: withState({ status: "neverChecked", version: "unknown" }),
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
 * A press that reached the backend but never got an answer: the updater was
 * dead, stopped, or never reached its watch loop, and the request expired
 * unpicked-up (issue #599, and the same defect as #587 — a request nobody is
 * waiting on any more does not sit forever, on either side of the seam).
 */
export const CheckFailedUpdaterNeverAnswered: Story = {
	args: withState({
		status: "checkFailed",
		version: CURRENT,
		reason: "The updater did not answer the check request before it expired.",
		lastCheckedAt: NOW - 3 * 24 * 60 * 60_000,
	}),
};

/**
 * The moment a check resolves: the timestamp reflects the press that just
 * completed, not whatever the updater's own cadence last did (issue #599).
 */
export const CheckedJustNow: Story = {
	args: withState({ status: "upToDate", version: CURRENT, checkedAt: NOW }),
};

/**
 * Back on a reachable server, on the new version. Dismissible, and gone for
 * good once dismissed.
 */
export const Succeeded: Story = {
	args: withState({
		status: "succeeded",
		runId: demoRunId,
		version: demoRelease.version,
		previousVersion: CURRENT,
		releaseNotesUrl: demoRelease.releaseNotesUrl,
	}),
};

/**
 * The new version did not start and Remit reports having put the old one back.
 * The pane repeats that report and no more: a failed migration is exactly the
 * case where something was changed on the way, so "nothing was lost" is not a
 * claim this screen is in any position to make.
 */
export const RolledBack: Story = {
	args: withState({
		status: "rolledBack",
		runId: demoRunId,
		version: CURRENT,
		attemptedVersion: demoRelease.version,
		reason:
			'migration 0042_add_thread_index failed: relation "threads" does not exist',
		logsCommand: demoLogsCommand,
	}),
};

/**
 * The new version did not start and the rollback to the old one failed too.
 * The one outcome Remit cannot resolve on its own: it names the failure and the
 * log verbatim, claims no running version, and sends the operator to a shell.
 */
export const RollbackFailed: Story = {
	args: withState({
		status: "rollbackFailed",
		runId: demoRunId,
		attemptedVersion: demoRelease.version,
		previousVersion: CURRENT,
		reason:
			"migration 0042_add_thread_index failed and the snapshot restore errored: database is locked",
		logsCommand: demoLogsCommand,
	}),
};

/**
 * The run stopped before it changed anything — a manifest that could not be
 * fetched, a preflight that refused. Nothing was installed and nothing was
 * touched, so the pane says exactly that and offers the retry.
 */
export const Abandoned: Story = {
	args: withState({
		status: "abandoned",
		runId: demoRunId,
		version: CURRENT,
		attemptedVersion: demoRelease.version,
		reason: "manifest fetch timed out before anything was pulled",
		logsCommand: demoLogsCommand,
	}),
};

/**
 * An update is running. The blocking screen owns the window; the pane behind it
 * still says what is going on rather than going blank.
 */
export const ApplyingBehindTheOverlay: Story = {
	args: withState({
		status: "applying",
		runId: demoRunId,
		version: CURRENT,
		target: demoRelease.version,
		phase: "restarting",
		elapsedSeconds: 30,
	}),
};

/**
 * The server answered again after a silence the client could not see into. It
 * says exactly that, and points at the log rather than guessing.
 */
export const RecoveredAfterUnreachable: Story = {
	args: withState({
		status: "unreachable",
		runId: demoRunId,
		previousVersion: CURRENT,
		attemptedVersion: demoRelease.version,
		elapsedSeconds: 420,
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
 * Consent for a release that also migrates the database. The extra line states
 * the forward step is one-way but a failed start is still rolled back — shown
 * only when the surface reports a higher schema version than the running one.
 */
export const ConfirmWithSchemaMigration: Story = {
	render: () => (
		<SelfUpdateConfirmDialog
			open
			currentVersion={CURRENT}
			release={demoRelease}
			appliesSchemaMigration
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
					onDismissResult={() => {}}
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
