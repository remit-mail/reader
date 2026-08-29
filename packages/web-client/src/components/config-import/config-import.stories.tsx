import type { Meta, StoryObj } from "@storybook/react-vite";
import { Server } from "lucide-react";
import { useState } from "react";
import { CredentialsStep } from "@/components/onboarding/credential-steps";
import { StepWelcome } from "@/components/onboarding/OnboardingWizard";
import { ConfigExportCard } from "@/components/settings/ConfigExportCard";
import {
	groupReportSections,
	pendingFolders,
	readFailure,
	sectionResults,
	writeFailure,
} from "@/lib/config-import";
import {
	accountsAllConnected,
	accountsAllPending,
	accountsOneFailed,
	CONFIG_FILE_NAME,
	cleanRunReport,
	dryRunReport,
	importedAccounts,
	partialImportReport,
	rejectedReports,
} from "./config-import.fixtures";
import {
	AccountCredentialsList,
	IMPORT_STEPS,
	StepAccountReconnectMicrosoft,
	StepChooseFile,
	StepCredentialsOverview,
	StepDryRunReport,
	StepFileRejected,
	StepInstanceAlreadyConfigured,
	StepPartialImport,
	StepPendingFolders,
} from "./steps";

const meta: Meta = {
	title: "Flows/Config import",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const rejectionFor = (key: keyof typeof rejectedReports) => {
	const failure = readFailure(rejectedReports[key]);
	if (!failure) throw new Error(`fixture ${key} carries no blocking error`);
	return failure;
};

const dryRunSections = groupReportSections(dryRunReport.items);

/**
 * Click-through walkthrough of the happy path: pick a file, read the dry run,
 * hand over the credentials the file does not carry, land on the folders that
 * are still waiting. "Go to inbox" loops back so it isn't a dead end.
 */
function ConfigImportWalkthrough() {
	const [index, setIndex] = useState(0);
	const back = () => setIndex((i) => Math.max(i - 1, 0));

	const screens = [
		<StepWelcome
			key="entry"
			onStart={() => undefined}
			onImportConfig={() => setIndex(1)}
		/>,
		<StepChooseFile
			key="file"
			file={{ name: CONFIG_FILE_NAME, size: 18_432 }}
			ready
			onNext={() => setIndex(2)}
		/>,
		<StepDryRunReport
			key="report"
			sections={dryRunSections}
			fileName={CONFIG_FILE_NAME}
			onBack={back}
			onNext={() => setIndex(3)}
		/>,
		<StepCredentialsOverview
			key="credentials"
			accounts={importedAccounts}
			onNext={() => setIndex(4)}
		/>,
		<StepPendingFolders
			key="folders"
			folders={pendingFolders(dryRunReport)}
			onNext={() => setIndex(0)}
		/>,
	];

	return screens[index];
}

/** Full click-through: onboarding entry through to the pending folders. */
export const Walkthrough: Story = {
	render: () => <ConfigImportWalkthrough />,
};

/** Onboarding: importing sits beside adding the first account, not under it. */
export const OnboardingEntry: Story = {
	render: () => (
		<StepWelcome onStart={() => undefined} onImportConfig={() => undefined} />
	),
};

/** Same entry at phone width — both CTAs share one footer row. */
export const OnboardingEntryPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => (
		<StepWelcome onStart={() => undefined} onImportConfig={() => undefined} />
	),
};

/** Drop target at rest. */
export const ChooseFile: Story = {
	render: () => <StepChooseFile />,
};

/** A file is over the drop target. */
export const ChooseFileDragging: Story = {
	render: () => <StepChooseFile state="dragging" />,
};

/** A file is chosen and parsed; the check is armed, nothing has been sent. */
export const ChooseFileChosen: Story = {
	render: () => (
		<StepChooseFile file={{ name: CONFIG_FILE_NAME, size: 18_432 }} ready />
	),
};

/** The browser is still pulling the file off disk — there is nothing to send yet. */
export const ChooseFileReading: Story = {
	render: () => (
		<StepChooseFile
			state="reading"
			file={{ name: CONFIG_FILE_NAME, size: 18_432 }}
		/>
	),
};

/** The dry run is in flight against the server. */
export const ChooseFileChecking: Story = {
	render: () => (
		<StepChooseFile
			state="checking"
			file={{ name: CONFIG_FILE_NAME, size: 18_432 }}
			ready
		/>
	),
};

/** A file that is not JSON at all, refused before anything leaves the browser. */
export const ChooseFileNotJson: Story = {
	render: () => (
		<StepChooseFile
			file={{ name: "vakantiefotos.zip", size: 4_194_304 }}
			failure={{
				title: "That file is not JSON",
				explanation:
					"vakantiefotos.zip could not be read as JSON at all, so there is nothing in it to import.",
				fix: "Pick the .json file written by Settings › Advanced, or by remit config save.",
				raw: "Unexpected token 'P', \"PK...\" is not valid JSON",
			}}
		/>
	),
};

/**
 * The dry run: every section with a per-entry verdict, and a stated reason
 * under everything that will not land.
 */
export const DryRunReport: Story = {
	render: () => (
		<StepDryRunReport
			sections={dryRunSections}
			fileName={CONFIG_FILE_NAME}
			warnings={dryRunReport.warnings.map((warning) => warning.message)}
		/>
	),
};

/** A fresh instance — the same file with nothing to skip or reject. */
export const DryRunReportCleanInstance: Story = {
	render: () => (
		<StepDryRunReport
			sections={groupReportSections(cleanRunReport.items)}
			fileName={CONFIG_FILE_NAME}
		/>
	),
};

/** The apply is in flight; the control says so rather than going quiet. */
export const DryRunReportApplying: Story = {
	render: () => (
		<StepDryRunReport
			sections={dryRunSections}
			fileName={CONFIG_FILE_NAME}
			applying
		/>
	),
};

/**
 * A file from a newer Reader carrying a section this one does not know. It gets
 * its own heading rather than being filed under a section we recognise, because
 * telling someone their settings landed somewhere they did not is the failure
 * the whole format exists to prevent.
 */
export const DryRunReportUnknownSection: Story = {
	render: () => (
		<StepDryRunReport
			sections={groupReportSections([
				...dryRunReport.items,
				{
					section: "messageDecisions",
					key: "3.412 message labels",
					verdict: "created",
				},
			])}
			fileName={CONFIG_FILE_NAME}
		/>
	),
};

/** Dry run at phone width — the verdict badges wrap rather than clip. */
export const DryRunReportPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => (
		<StepDryRunReport sections={dryRunSections} fileName={CONFIG_FILE_NAME} />
	),
};

const HELD =
	"2 accounts, 14 rules and 31 flagged senders are set up here already.";

/** 409: the instance is already configured, and neither choice is preselected. */
export const AlreadyConfigured: Story = {
	render: () => <StepInstanceAlreadyConfigured held={HELD} />,
};

/** Abort chosen: nothing is written. */
export const AlreadyConfiguredAbort: Story = {
	render: () => <StepInstanceAlreadyConfigured held={HELD} choice="abort" />,
};

/** Merge chosen: adds and updates only, existing accounts keep their servers. */
export const AlreadyConfiguredMerge: Story = {
	render: () => <StepInstanceAlreadyConfigured held={HELD} choice="merge" />,
};

/** Two of three accounts cannot sync until someone signs in. */
export const CredentialsOverview: Story = {
	render: () => <StepCredentialsOverview accounts={importedAccounts} />,
};

/** Straight after the import: no account has credentials yet. */
export const CredentialsOverviewAllPending: Story = {
	render: () => <StepCredentialsOverview accounts={accountsAllPending} />,
};

/** A password was entered and the server refused it — the row says why. */
export const CredentialsOverviewSignInFailed: Story = {
	render: () => <StepCredentialsOverview accounts={accountsOneFailed} />,
};

/** A Microsoft reconnect is in flight; its row is busy, the rest are live. */
export const CredentialsOverviewRedirecting: Story = {
	render: () => (
		<StepCredentialsOverview
			accounts={importedAccounts}
			busyAccountId="acct-amstelveen"
		/>
	),
};

/** Every account connected — the step is finally satisfiable. */
export const CredentialsOverviewComplete: Story = {
	render: () => <StepCredentialsOverview accounts={accountsAllConnected} />,
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

const passwordStepProps = {
	steps: IMPORT_STEPS,
	activeStep: 2,
	title: "Sign in to post@vanhenten-advies.nl",
	subtitle: "Account 2 of 3 · mail.antagonist.nl:993",
	email: "post@vanhenten-advies.nl",
	username: "post@vanhenten-advies.nl",
	password: "",
	continueLabel: "Test and continue",
	notice: (
		<div className="flex items-center gap-2 text-xs text-fg-muted">
			<Server className="size-3.5" />
			Server settings came from the config file — edit them in Settings if they
			are wrong.
		</div>
	),
	onContinue: () => undefined,
	onBack: () => undefined,
	onChange: () => undefined,
};

/** Password entry for one imported IMAP account. */
export const AccountPassword: Story = {
	render: () => <CredentialsStep {...passwordStepProps} />,
};

/** Retry after a refused password: the server's own words, then the fix. */
export const AccountPasswordRejected: Story = {
	render: () => (
		<CredentialsStep
			{...passwordStepProps}
			error="535 5.7.8 Authentication credentials invalid. Antagonist wants the mailbox password, not your control-panel login."
		/>
	),
};

/** The Microsoft branch: no token travels in a config file. */
export const AccountReconnectMicrosoft: Story = {
	render: () => (
		<StepAccountReconnectMicrosoft
			account={importedAccounts[2]}
			position={3}
			total={3}
		/>
	),
};

/** Microsoft sign-in stopped at the tenant's admin-consent screen. */
export const AccountReconnectMicrosoftBlocked: Story = {
	render: () => (
		<StepAccountReconnectMicrosoft
			account={importedAccounts[2]}
			position={3}
			total={3}
			error="Microsoft stopped the sign-in: your organisation requires an administrator to approve Reader. Ask IT to approve it, then reconnect."
		/>
	),
};

/** Imported settings that name folders discovery has not produced yet. */
export const PendingFolders: Story = {
	render: () => <StepPendingFolders folders={pendingFolders(dryRunReport)} />,
};

/** Nothing left waiting: every folder the file named already resolved. */
export const PendingFoldersNone: Story = {
	render: () => <StepPendingFolders folders={[]} />,
};

/** Not a Reader config file at all. */
export const RejectedWrongFileKind: Story = {
	render: () => <StepFileRejected failure={rejectionFor("wrongKind")} />,
};

/** Written by a newer Reader — update before importing. */
export const RejectedNewerSchema: Story = {
	render: () => <StepFileRejected failure={rejectionFor("newerSchema")} />,
};

/** Keys this version does not know: refused rather than silently ignored. */
export const RejectedUnknownKey: Story = {
	render: () => <StepFileRejected failure={rejectionFor("unknownKey")} />,
};

/** The file carries a password: rejected outright, never quietly stripped. */
export const RejectedCredentialField: Story = {
	render: () => <StepFileRejected failure={rejectionFor("credentialField")} />,
};

/**
 * The same stop, with a server that did not say where. Nothing here may read
 * "landed": the reader has to go and look, and the screen says so.
 */
export const PartiallyLandedImportUnnamed: Story = {
	render: () => {
		const report = {
			...partialImportReport,
			errors: [
				{ code: "import_write_failed", message: "the store refused the write" },
			],
		};
		return (
			<StepPartialImport
				results={sectionResults(report)}
				message={writeFailure(report)?.message ?? ""}
				raw="import_write_failed: the store refused the write"
			/>
		);
	},
};

/** An import that stopped half-way, saying exactly what landed. */
export const PartiallyLandedImport: Story = {
	render: () => (
		<StepPartialImport
			results={sectionResults(partialImportReport)}
			message={writeFailure(partialImportReport)?.message ?? ""}
			raw={`import_write_failed: ${writeFailure(partialImportReport)?.message ?? ""}`}
		/>
	),
};

/** Settings → Advanced: the export half of the pair. */
export const ExportCard: Story = {
	render: () => (
		<div className="min-h-dvh bg-canvas p-6 font-sans">
			<ConfigExportCard fileName="reader-config.2026-08-28.json" />
		</div>
	),
};

/** The export is being read; the button says so rather than going quiet. */
export const ExportCardDownloading: Story = {
	render: () => (
		<div className="min-h-dvh bg-canvas p-6 font-sans">
			<ConfigExportCard
				fileName="reader-config.2026-08-28.json"
				state="downloading"
			/>
		</div>
	),
};

/** The export failed — a dead download button would be the worse outcome. */
export const ExportCardFailed: Story = {
	render: () => (
		<div className="min-h-dvh bg-canvas p-6 font-sans">
			<ConfigExportCard
				fileName="reader-config.2026-08-28.json"
				state="failed"
				error="500 Internal Server Error — GET /config/export: sender store unreadable"
			/>
		</div>
	),
};
