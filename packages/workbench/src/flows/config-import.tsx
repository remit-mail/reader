import {
	AppPasswordHint,
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHeader,
	CardTitle,
	CheckRow,
	ConnectorTile,
	FieldLabel,
	Input,
	PasswordInput,
	WizardShell,
} from "@remit/ui";
import {
	Download,
	FileJson,
	FolderClock,
	Inbox,
	KeyRound,
	Merge,
	Server,
	Upload,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	type ConfigSection,
	type CredentialState,
	configFile,
	countVerdicts,
	dryRunSections,
	exportContents,
	exportFileName,
	type ImportedAccount,
	type ImportFailure,
	importedAccounts,
	importFailures,
	type PartialResult,
	type PendingFolder,
	partialFailureRaw,
	partialResults,
	pendingFolders,
	type Verdict,
} from "../fixtures/config-import.js";

/**
 * Config import as static compositions: pick a file, read the dry run, settle
 * the conflicts, then hand over the credentials the file deliberately does not
 * carry. One component per surface; the stories render one each.
 */

export const steps = ["File", "Review", "Credentials", "Folders"];

interface StepNav {
	onBack?: () => void;
	onNext?: () => void;
}

function RawError({ children }: { children: string }) {
	return (
		<code className="block rounded bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
			{children}
		</code>
	);
}

const verdictTone: Record<
	Verdict,
	"neutral" | "positive" | "warning" | "danger" | "accent"
> = {
	created: "positive",
	updated: "accent",
	unchanged: "neutral",
	skipped: "warning",
	rejected: "danger",
};

export function StepChooseFile({
	state = "idle",
	onNext,
}: { state?: "idle" | "dragging" | "reading" } & StepNav) {
	const dragging = state === "dragging";
	const reading = state === "reading";
	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			title="Import a config file"
			subtitle="Accounts, folder roles, rules, senders and appearance — everything except passwords."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						Nothing is written until you have seen what will change.
					</span>
					<Button variant="primary" disabled={reading} onClick={onNext}>
						{reading ? "Reading…" : "Check the file"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div
					className={
						dragging
							? "flex flex-col items-center gap-3 rounded-sm border-2 border-dashed border-accent bg-accent-soft px-4 py-9 text-center"
							: "flex flex-col items-center gap-3 rounded-sm border-2 border-dashed border-line px-4 py-9 text-center"
					}
				>
					<span className="flex size-11 items-center justify-center rounded-md bg-surface-sunken">
						<Upload className="size-5 text-fg-muted" />
					</span>
					<div>
						<p className="text-sm font-medium text-fg">
							{dragging
								? "Drop it here"
								: "Drop a config file here, or choose one"}
						</p>
						<p className="mt-1 text-xs text-fg-subtle">
							A .json file written by Reader — up to 2 MB.
						</p>
					</div>
					<Button variant="secondary" size="sm">
						Choose file
					</Button>
				</div>
				{reading && (
					<div className="flex items-start gap-3 rounded-sm border border-line px-3 py-2.5">
						<FileJson className="mt-0.5 size-4 shrink-0 text-fg-muted" />
						<div className="min-w-0">
							<p className="truncate text-sm text-fg">{configFile.name}</p>
							<p className="mt-0.5 text-xs text-fg-subtle">
								{configFile.size} · written by {configFile.writtenBy} on{" "}
								{configFile.host}, {configFile.writtenAt}
							</p>
						</div>
					</div>
				)}
				<p className="text-2xs text-fg-subtle">
					Export one from Settings → Advanced on the instance you are moving
					from, or run{" "}
					<code className="rounded bg-surface-sunken px-1 py-0.5">
						remit config save
					</code>{" "}
					on its host.
				</p>
			</div>
		</WizardShell>
	);
}

function VerdictSummary({ sections }: { sections: ConfigSection[] }) {
	const counts = countVerdicts(sections);
	const order: Verdict[] = [
		"created",
		"updated",
		"unchanged",
		"skipped",
		"rejected",
	];
	return (
		<div className="flex flex-wrap gap-1.5">
			{order
				.filter((verdict) => counts[verdict] > 0)
				.map((verdict) => (
					<Badge key={verdict} tone={verdictTone[verdict]} dot>
						{counts[verdict]} {verdict}
					</Badge>
				))}
		</div>
	);
}

function SectionReport({ section }: { section: ConfigSection }) {
	return (
		<section>
			<h2 className="text-sm font-semibold text-fg">{section.title}</h2>
			<ul className="mt-1.5 divide-y divide-line">
				{section.entries.map((entry) => (
					<li key={entry.id} className="flex items-start gap-3 py-2">
						<Badge
							tone={verdictTone[entry.verdict]}
							className="mt-0.5 shrink-0"
						>
							{entry.verdict}
						</Badge>
						<div className="min-w-0">
							<p className="text-sm text-fg">{entry.label}</p>
							<p className="mt-0.5 text-xs text-fg-subtle">{entry.detail}</p>
							{entry.reason && (
								<p
									className={
										entry.verdict === "rejected"
											? "mt-1 text-xs text-danger"
											: "mt-1 text-xs text-warning"
									}
								>
									{entry.reason}
								</p>
							)}
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

export function StepDryRunReport({
	sections = dryRunSections,
	onBack,
	onNext,
}: { sections?: ConfigSection[] } & StepNav) {
	const counts = countVerdicts(sections);
	const willWrite = counts.created + counts.updated;
	const held = counts.skipped + counts.rejected;
	return (
		<WizardShell
			steps={steps}
			activeStep={1}
			title="What this file will change"
			subtitle={`${configFile.name} · nothing has been written yet.`}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Choose another file
					</Button>
					<Button variant="primary" onClick={onNext}>
						Import {willWrite} changes
					</Button>
				</>
			}
		>
			<div className="space-y-5">
				<VerdictSummary sections={sections} />
				{held > 0 && (
					<Banner tone="warning">
						{held} entries will not be imported. Each says why below — read them
						before you continue, because nothing here retries on its own.
					</Banner>
				)}
				{sections.map((section) => (
					<SectionReport key={section.id} section={section} />
				))}
			</div>
		</WizardShell>
	);
}

export function StepInstanceAlreadyConfigured({
	choice,
	onBack,
	onNext,
}: { choice?: "abort" | "merge" } & StepNav) {
	return (
		<WizardShell
			steps={steps}
			activeStep={1}
			title="This instance already has configuration"
			subtitle="2 accounts, 14 rules and 31 flagged senders are set up here already."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Choose another file
					</Button>
					<Button variant="primary" disabled={!choice} onClick={onNext}>
						{choice === "merge" ? "Continue with merge" : "Continue"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Banner tone="warning">
					An import into a configured instance can only add and update — it
					never deletes what is here. Pick how the two should meet.
				</Banner>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<ConnectorTile
						name="Stop, keep this instance"
						description="Nothing is written. Use this if you meant to import into a fresh instance."
						icon={<X className="size-5" />}
						selected={choice === "abort"}
						onSelect={() => {}}
					/>
					<ConnectorTile
						name="Merge the file in"
						description="Adds what is missing and updates what differs. Existing accounts keep their server settings."
						icon={<Merge className="size-5" />}
						selected={choice === "merge"}
						onSelect={() => {}}
					/>
				</div>
				{choice === "merge" && (
					<p className="text-xs text-fg-muted">
						The next screen lists every add and update before anything is
						written.
					</p>
				)}
			</div>
		</WizardShell>
	);
}

function credentialBadge(state: CredentialState): ReactNode {
	if (state === "entered") return <Badge tone="positive">ready</Badge>;
	if (state === "failed") return <Badge tone="danger">sign-in failed</Badge>;
	return <Badge tone="danger">credentials needed</Badge>;
}

export function AccountCredentialsList({
	accounts = importedAccounts,
	onOpen,
}: {
	accounts?: ImportedAccount[];
	onOpen?: (account: ImportedAccount) => void;
}) {
	return (
		<ul className="divide-y divide-line">
			{accounts.map((account) => (
				<li
					key={account.id}
					className={
						account.state === "entered"
							? "flex flex-wrap items-start justify-between gap-3 py-3"
							: "flex flex-wrap items-start justify-between gap-3 border-l-2 border-danger bg-danger-soft py-3 pl-3"
					}
				>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-medium text-fg">
								{account.address}
							</span>
							{credentialBadge(account.state)}
						</div>
						<p className="mt-0.5 text-xs text-fg-subtle">
							{account.displayName} ·{" "}
							{account.connector === "microsoft"
								? "Microsoft 365"
								: "IMAP / SMTP"}{" "}
							· {account.server}
						</p>
						{account.state !== "entered" && (
							<p className="mt-1 text-xs text-danger">
								{account.failure ??
									(account.connector === "microsoft"
										? "Config files never carry OAuth tokens. Reconnect with Microsoft to start syncing this account."
										: "Config files never carry passwords. Enter this mailbox's password to start syncing.")}
							</p>
						)}
					</div>
					{account.state !== "entered" && (
						<Button
							variant="primary"
							size="sm"
							icon={
								account.connector === "microsoft" ? (
									<Inbox className="size-3.5" />
								) : (
									<KeyRound className="size-3.5" />
								)
							}
							onClick={() => onOpen?.(account)}
						>
							{account.connector === "microsoft"
								? "Reconnect"
								: account.state === "failed"
									? "Try again"
									: "Enter password"}
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}

export function StepCredentialsOverview({
	accounts = importedAccounts,
	onBack,
	onNext,
}: { accounts?: ImportedAccount[] } & StepNav) {
	const outstanding = accounts.filter(
		(account) => account.state !== "entered",
	).length;
	return (
		<WizardShell
			steps={steps}
			activeStep={2}
			title="These accounts need credentials"
			subtitle="The config file carries servers and settings. Passwords and Microsoft sign-ins it deliberately leaves out."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" disabled={outstanding > 0} onClick={onNext}>
						{outstanding > 0
							? `${outstanding} still to go`
							: "All accounts connected"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{outstanding > 0 && (
					<Banner tone="danger">
						{outstanding} of {accounts.length} accounts cannot sync yet. They
						stay listed in Settings, marked like this, until you sign in — no
						mail arrives for them in the meantime.
					</Banner>
				)}
				<AccountCredentialsList accounts={accounts} />
			</div>
		</WizardShell>
	);
}

export function StepAccountPassword({
	account = importedAccounts[1],
	position = 2,
	total = 3,
	error,
	onBack,
	onNext,
}: {
	account?: ImportedAccount;
	position?: number;
	total?: number;
	error?: string;
} & StepNav) {
	return (
		<WizardShell
			steps={steps}
			activeStep={2}
			title={`Sign in to ${account.address}`}
			subtitle={`Account ${position} of ${total} · ${account.server}`}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" onClick={onNext}>
						Test and continue
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				{error && <Banner tone="danger">{error}</Banner>}
				<div className="flex items-center gap-2 text-xs text-fg-muted">
					<Server className="size-3.5" />
					Imported from the config file — edit in Settings if it is wrong.
				</div>
				<div>
					<FieldLabel htmlFor="import-username">Username</FieldLabel>
					<Input id="import-username" defaultValue={account.address} />
				</div>
				<div>
					<FieldLabel htmlFor="import-password">
						Password or app password
					</FieldLabel>
					<PasswordInput id="import-password" />
				</div>
				<AppPasswordHint />
			</div>
		</WizardShell>
	);
}

export function StepAccountReconnectMicrosoft({
	account = importedAccounts[2],
	position = 3,
	total = 3,
	error,
	onBack,
	onNext,
}: {
	account?: ImportedAccount;
	position?: number;
	total?: number;
	error?: string;
} & StepNav) {
	return (
		<WizardShell
			steps={steps}
			activeStep={2}
			title={`Reconnect ${account.address}`}
			subtitle={`Account ${position} of ${total} · Microsoft 365`}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" onClick={onNext}>
						Sign in with Microsoft
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{error && <Banner tone="danger">{error}</Banner>}
				<Banner tone="info">
					A config file never carries an OAuth token — one only works for the
					instance it was granted to. Signing in here mints a fresh one for this
					instance.
				</Banner>
				<div className="rounded-sm border border-line px-3 py-2.5">
					<p className="text-sm text-fg">{account.displayName}</p>
					<p className="mt-0.5 text-xs text-fg-subtle">
						{account.address} · {account.server}
					</p>
				</div>
				<p className="text-2xs text-fg-subtle">
					You will be sent to Microsoft and returned here. If your organisation
					requires admin approval, the sign-in stops there and this account
					keeps waiting.
				</p>
			</div>
		</WizardShell>
	);
}

function folderRows(folders: PendingFolder[]) {
	return folders.map((folder) => (
		<CheckRow
			key={`${folder.account}-${folder.path}`}
			label={folder.path}
			detail={`${folder.account} · ${folder.waitingFor}`}
			state="pending"
		/>
	));
}

export function StepPendingFolders({
	folders = pendingFolders,
	onNext,
}: { folders?: PendingFolder[] } & StepNav) {
	return (
		<WizardShell
			steps={steps}
			activeStep={3}
			title="Waiting on folders"
			subtitle="The config names folders this server has not shown us yet."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						Folder discovery runs with every sync.
					</span>
					<Button variant="primary" onClick={onNext}>
						Go to inbox
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Banner tone="warning">
					{folders.length} settings are imported but switched off. Each turns
					itself on the moment its folder appears — nothing was dropped. If a
					folder never appears, create it in your mail client, or edit the
					setting in Settings → Senders & Rules.
				</Banner>
				<div className="flex items-center gap-2 text-xs text-fg-muted">
					<FolderClock className="size-4" />
					Last folder discovery: 2 minutes ago
				</div>
				<div className="divide-y divide-line">{folderRows(folders)}</div>
			</div>
		</WizardShell>
	);
}

export function OnboardingImportEntry({
	onAddAccount,
	onImport,
}: {
	onAddAccount?: () => void;
	onImport?: () => void;
} = {}) {
	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			hideSteps
			title="Welcome to Remit"
			subtitle="Set up your first account, or bring the settings from another Reader."
			footer={
				<>
					<Button
						variant="secondary"
						icon={<FileJson className="size-4" />}
						onClick={onImport}
					>
						Import a config file
					</Button>
					<Button variant="primary" onClick={onAddAccount}>
						Add your first account
					</Button>
				</>
			}
		>
			<div className="flex flex-col items-start py-5">
				<span className="flex size-14 items-center justify-center rounded-md bg-accent-soft">
					<Inbox className="size-7 text-accent" />
				</span>
				<p className="mt-5 max-w-sm text-sm leading-relaxed text-fg-muted">
					A config file carries your accounts, folder roles, rules, flagged
					senders and appearance from another Reader. It never carries
					passwords, so you sign in again here.
				</p>
			</div>
		</WizardShell>
	);
}

export function StepFileRejected({
	reason = "wrong-kind",
	onBack,
}: { reason?: ImportFailure } & StepNav) {
	const copy = importFailures[reason];
	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			title={copy.title}
			subtitle="Nothing was imported."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						This instance is unchanged.
					</span>
					<Button variant="primary" onClick={onBack}>
						Choose another file
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				<Banner tone="danger">{copy.explanation}</Banner>
				<p className="text-sm text-fg">{copy.fix}</p>
				<RawError>{copy.raw}</RawError>
			</div>
		</WizardShell>
	);
}

function resultState(state: PartialResult["state"]) {
	if (state === "landed") return "ok" as const;
	if (state === "failed") return "failed" as const;
	return "pending" as const;
}

export function StepPartialImport({
	results = partialResults,
	onBack,
}: { results?: PartialResult[] } & StepNav) {
	const landed = results.filter((r) => r.state === "landed").length;
	return (
		<WizardShell
			steps={steps}
			activeStep={1}
			title="The import stopped part-way"
			subtitle={`${landed} of ${results.length} sections landed. What landed is live and stays.`}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back to settings
					</Button>
					<Button variant="primary">Retry the rest</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Banner tone="danger">
					Reader could not write the rules section and stopped there rather than
					leaving half a rule set behind. Retrying is safe: sections that
					already landed are recognised and skipped.
				</Banner>
				<div className="divide-y divide-line">
					{results.map((result) => (
						<CheckRow
							key={result.section}
							label={result.section}
							detail={result.detail}
							state={resultState(result.state)}
						/>
					))}
				</div>
				<RawError>{partialFailureRaw}</RawError>
			</div>
		</WizardShell>
	);
}

export function ConfigExportCard({
	state = "ready",
}: {
	state?: "ready" | "failed";
} = {}) {
	return (
		<Card className="max-w-xl">
			<CardHeader>
				<CardTitle>Configuration file</CardTitle>
			</CardHeader>
			<CardBody>
				<p>
					Download everything this instance is set up with, to move it to
					another Reader or keep alongside your backups.
				</p>
				<p className="mt-2 text-xs text-fg-subtle">{exportContents}</p>
				{state === "failed" ? (
					<div className="mt-3 space-y-2 rounded-sm border border-danger/40 bg-danger-soft px-3 py-2.5">
						<p className="text-sm font-medium text-danger">
							The config file could not be written.
						</p>
						<p className="text-xs text-fg-muted">
							Nothing was downloaded. Try again — if it keeps failing,{" "}
							<a href="#report" className="text-accent underline">
								report it
							</a>{" "}
							and use <code>remit config save</code> on the host in the
							meantime.
						</p>
						<RawError>
							500 Internal Server Error — GET /config/export: sender store
							unreadable
						</RawError>
					</div>
				) : (
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							icon={<Download className="size-3.5" />}
						>
							Download {exportFileName}
						</Button>
						<Badge tone="neutral">no passwords</Badge>
					</div>
				)}
				<p className="mt-3 text-2xs text-fg-subtle">
					On the host, the same file comes from{" "}
					<code className="rounded bg-surface-sunken px-1 py-0.5">
						remit config save ~/{exportFileName}
					</code>
					.
				</p>
			</CardBody>
		</Card>
	);
}
