import {
	demoLogsCommand,
	demoRelease,
	SelfUpdateConfirmDialog,
	SelfUpdateProgressOverlay,
	SelfUpdateSection,
	type SelfUpdateState,
	SelfUpdateUnreachableScreen,
	type SettingsNavItem,
	SettingsShell,
	UpdateAvailableDot,
} from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Inbox, Palette, Users, Wrench } from "lucide-react";
import { useState } from "react";

const NOW = Date.parse("2026-07-20T12:00:00.000Z");
const CURRENT = "0.9.3";

const meta: Meta = {
	title: "Screens/Settings self-update",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

function navItems(updateAvailable: boolean): SettingsNavItem[] {
	return [
		{ id: "accounts", label: "Accounts", icon: <Inbox className="size-4" /> },
		{
			id: "senders",
			label: "Senders & Rules",
			icon: <Users className="size-4" />,
		},
		{
			id: "appearance",
			label: "Appearance",
			icon: <Palette className="size-4" />,
		},
		{
			id: "advanced",
			label: "Advanced",
			icon: (
				<UpdateAvailableDot show={updateAvailable}>
					<Wrench className="size-4" />
				</UpdateAvailableDot>
			),
		},
	];
}

const updatesHelp = (
	<div className="space-y-3">
		<p>
			This Remit runs on a server you control, so nothing is installed on it
			without you saying so.
		</p>
		<p>
			An update replaces the Remit software only. Your mail lives at your
			provider and is never copied, moved or deleted by an update.
		</p>
		<p>
			If a new version fails to start, the old one is put back automatically —
			the worst case is a few minutes without mail, not a lost mailbox.
		</p>
	</div>
);

function AdvancedPage({ state }: { state: SelfUpdateState }) {
	const [helpOpen, setHelpOpen] = useState(true);
	const [confirming, setConfirming] = useState(false);

	return (
		<SettingsShell
			items={navItems(state.status === "available")}
			activeId="advanced"
			title="Advanced"
			description="Updates, diagnostics, and export."
			help={updatesHelp}
			helpOpen={helpOpen}
			onToggleHelp={() => setHelpOpen((v) => !v)}
		>
			<SelfUpdateSection
				now={NOW}
				state={state}
				onCheck={() => {}}
				onInstall={() => setConfirming(true)}
				onDismissResult={() => {}}
			/>
			<div className="border-t border-line pt-4">
				<p className="mb-1 text-sm font-medium text-fg">About</p>
				<p className="text-xs text-fg-subtle">
					Remit {state.status === "succeeded" ? state.version : CURRENT} · self
					hosted
				</p>
			</div>
			<SelfUpdateConfirmDialog
				open={confirming}
				currentVersion={CURRENT}
				release={demoRelease}
				onClose={() => setConfirming(false)}
				onConfirm={() => setConfirming(false)}
			/>
		</SettingsShell>
	);
}

/**
 * Where this lives: Settings › Advanced, first section. The pane is the only
 * surface that ever talks about updates.
 */
export const AdvancedUpToDate: Story = {
	render: () => (
		<AdvancedPage
			state={{
				status: "upToDate",
				version: CURRENT,
				checkedAt: NOW - 21 * 60_000,
			}}
		/>
	),
};

/**
 * How loud an available update gets: a dot on the Advanced nav item and a row
 * in this pane. No banner over the mailbox, no modal, no repeat prompt — a
 * mail client that interrupts reading to talk about itself has its priorities
 * backwards.
 */
export const AdvancedUpdateAvailable: Story = {
	render: () => (
		<AdvancedPage
			state={{ status: "available", version: CURRENT, release: demoRelease }}
		/>
	),
};

export const AdvancedCheckFailed: Story = {
	render: () => (
		<AdvancedPage
			state={{
				status: "checkFailed",
				version: CURRENT,
				reason: "No route to github.com — the server has no outbound network.",
				lastCheckedAt: NOW - 3 * 24 * 60 * 60_000,
			}}
		/>
	),
};

export const AdvancedSucceeded: Story = {
	render: () => (
		<AdvancedPage
			state={{
				status: "succeeded",
				version: demoRelease.version,
				previousVersion: CURRENT,
				releaseNotesUrl: demoRelease.releaseNotesUrl,
			}}
		/>
	),
};

export const AdvancedRolledBack: Story = {
	render: () => (
		<AdvancedPage
			state={{
				status: "rolledBack",
				version: CURRENT,
				attemptedVersion: demoRelease.version,
				reason:
					'migration 0042_add_thread_index failed: relation "threads" does not exist',
				logsCommand: demoLogsCommand,
			}}
		/>
	),
};

/**
 * Once consent is given the app is genuinely unusable — the server it reads
 * mail from is restarting — so the restart screen takes the whole window
 * rather than spinning quietly over a mailbox that cannot load.
 */
export const RestartInProgress: Story = {
	render: () => (
		<div className="relative h-dvh w-full bg-canvas">
			<SelfUpdateProgressOverlay
				target={demoRelease.version}
				phase="reconnecting"
				elapsedSeconds={52}
			/>
		</div>
	),
};

/** The server never answered again. */
export const ServerNeverCameBack: Story = {
	render: () => (
		<div className="relative h-dvh w-full bg-canvas">
			<SelfUpdateUnreachableScreen
				attemptedVersion={demoRelease.version}
				previousVersion={CURRENT}
				elapsedSeconds={420}
				logsCommand={demoLogsCommand}
				onRetryConnection={() => {}}
			/>
		</div>
	),
};
