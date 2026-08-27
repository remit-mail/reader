import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	accountsAllPending,
	accountsOneFailed,
	cleanRunSections,
	importedAccounts,
} from "../fixtures/config-import.js";
import {
	AccountCredentialsList,
	ConfigExportCard,
	OnboardingImportEntry,
	StepAccountPassword,
	StepAccountReconnectMicrosoft,
	StepChooseFile,
	StepCredentialsOverview,
	StepDryRunReport,
	StepFileRejected,
	StepInstanceAlreadyConfigured,
	StepPartialImport,
	StepPendingFolders,
} from "./config-import.js";

const meta: Meta = {
	title: "Flows/Config import",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * Click-through walkthrough of the happy path: pick a file, read the dry run,
 * hand over the credentials the file does not carry, land on the folders that
 * are still waiting. "Go to inbox" loops back so it isn't a dead end.
 */
function ConfigImportWalkthrough() {
	const [index, setIndex] = useState(0);
	const back = () => setIndex((i) => Math.max(i - 1, 0));
	const restart = () => setIndex(0);

	const screens = [
		<OnboardingImportEntry key="entry" onImport={() => setIndex(1)} />,
		<StepChooseFile key="file" onNext={() => setIndex(2)} />,
		<StepDryRunReport key="report" onBack={back} onNext={() => setIndex(3)} />,
		<StepCredentialsOverview
			key="credentials"
			onBack={back}
			onNext={() => setIndex(4)}
		/>,
		<StepPendingFolders key="folders" onNext={restart} />,
	];

	return screens[index];
}

/** Full click-through: onboarding entry through to the pending folders. */
export const Walkthrough: Story = {
	render: () => <ConfigImportWalkthrough />,
};

/** Onboarding: importing sits beside adding the first account, not under it. */
export const OnboardingEntry: Story = {
	render: () => <OnboardingImportEntry />,
};

/** Same entry at phone width — both CTAs share one footer row. */
export const OnboardingEntryPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => <OnboardingImportEntry />,
};

/** Drop target at rest. */
export const ChooseFile: Story = {
	render: () => <StepChooseFile />,
};

/** A file is over the drop target. */
export const ChooseFileDragging: Story = {
	render: () => <StepChooseFile state="dragging" />,
};

/** File accepted and being read: name, size, and which Reader wrote it. */
export const ChooseFileReading: Story = {
	render: () => <StepChooseFile state="reading" />,
};

/**
 * The dry run: every section with a per-entry verdict, and a stated reason
 * under everything that will not land.
 */
export const DryRunReport: Story = {
	render: () => <StepDryRunReport />,
};

/** A fresh instance — the same file with nothing to skip or reject. */
export const DryRunReportCleanInstance: Story = {
	render: () => <StepDryRunReport sections={cleanRunSections} />,
};

/** Dry run at phone width — the verdict badges wrap rather than clip. */
export const DryRunReportPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => <StepDryRunReport />,
};

/** 409: the instance is already configured, and neither choice is preselected. */
export const AlreadyConfigured: Story = {
	render: () => <StepInstanceAlreadyConfigured />,
};

/** Abort chosen: nothing is written. */
export const AlreadyConfiguredAbort: Story = {
	render: () => <StepInstanceAlreadyConfigured choice="abort" />,
};

/** Merge chosen: adds and updates only, existing accounts keep their servers. */
export const AlreadyConfiguredMerge: Story = {
	render: () => <StepInstanceAlreadyConfigured choice="merge" />,
};

/** Two of three accounts cannot sync until someone signs in. */
export const CredentialsOverview: Story = {
	render: () => <StepCredentialsOverview />,
};

/** Straight after the import: no account has credentials yet. */
export const CredentialsOverviewAllPending: Story = {
	render: () => <StepCredentialsOverview accounts={accountsAllPending} />,
};

/** A password was entered and the server refused it — the row says why. */
export const CredentialsOverviewSignInFailed: Story = {
	render: () => <StepCredentialsOverview accounts={accountsOneFailed} />,
};

/** Every account connected — the step is finally satisfiable. */
export const CredentialsOverviewComplete: Story = {
	render: () => (
		<StepCredentialsOverview
			accounts={importedAccounts.map((account) => ({
				...account,
				state: "entered" as const,
			}))}
		/>
	),
};

/** The same account rows as they read in Settings, outside the wizard. */
export const AccountsNeedingCredentialsInSettings: Story = {
	render: () => (
		<div className="min-h-dvh bg-canvas p-6 font-sans">
			<div className="max-w-2xl">
				<AccountCredentialsList accounts={accountsOneFailed} />
			</div>
		</div>
	),
};

/** Password entry for one imported IMAP account. */
export const AccountPassword: Story = {
	render: () => <StepAccountPassword />,
};

/** Retry after a refused password: the server's own words, then the fix. */
export const AccountPasswordRejected: Story = {
	render: () => (
		<StepAccountPassword error="535 5.7.8 Authentication credentials invalid. Antagonist wants the mailbox password, not your control-panel login." />
	),
};

/** The Microsoft branch: no token travels in a config file. */
export const AccountReconnectMicrosoft: Story = {
	render: () => <StepAccountReconnectMicrosoft />,
};

/** Microsoft sign-in stopped at the tenant's admin-consent screen. */
export const AccountReconnectMicrosoftBlocked: Story = {
	render: () => (
		<StepAccountReconnectMicrosoft error="Microsoft stopped the sign-in: your organisation requires an administrator to approve Reader. Ask IT to approve it, then reconnect." />
	),
};

/** Imported settings that name folders discovery has not produced yet. */
export const PendingFolders: Story = {
	render: () => <StepPendingFolders />,
};

/** Not a Reader config file at all. */
export const RejectedWrongFileKind: Story = {
	render: () => <StepFileRejected reason="wrong-kind" />,
};

/** Written by a newer Reader — update before importing. */
export const RejectedNewerSchema: Story = {
	render: () => <StepFileRejected reason="newer-schema" />,
};

/** Keys this version does not know: refused rather than silently ignored. */
export const RejectedUnknownKey: Story = {
	render: () => <StepFileRejected reason="unknown-key" />,
};

/** The file carries a password: rejected outright, never quietly stripped. */
export const RejectedCredentialField: Story = {
	render: () => <StepFileRejected reason="credential-field" />,
};

/** An import that stopped half-way, saying exactly what landed. */
export const PartiallyLandedImport: Story = {
	render: () => <StepPartialImport />,
};

/** Settings → Advanced: the export half of the pair. */
export const ExportCard: Story = {
	render: () => (
		<div className="min-h-dvh bg-canvas p-6 font-sans">
			<ConfigExportCard />
		</div>
	),
};

/** The export failed — a dead download button would be the worse outcome. */
export const ExportCardFailed: Story = {
	render: () => (
		<div className="min-h-dvh bg-canvas p-6 font-sans">
			<ConfigExportCard state="failed" />
		</div>
	),
};
