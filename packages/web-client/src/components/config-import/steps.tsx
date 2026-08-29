/**
 * The config import screens, one component per surface (#1021 stage 5).
 *
 * Every one of these is a pure function of props: the wizard around them owns
 * the file, the network and the step. That is what lets Storybook render each
 * state — including the ones that only exist when a server refuses something —
 * against the same components the app runs.
 */

import {
	Badge,
	Banner,
	Button,
	CheckRow,
	ConnectorTile,
	WizardShell,
} from "@remit/ui";
import {
	FileJson,
	FolderClock,
	Inbox,
	KeyRound,
	Loader2,
	Merge,
	Upload,
	X,
} from "lucide-react";
import type { DragEvent, ReactNode } from "react";
import { useId, useRef } from "react";
import {
	countVerdicts,
	type FailureCopy,
	formatFileSize,
	type PendingFolder,
	type ReportSection,
	type SectionResult,
	verdictTone,
} from "@/lib/config-import";

export const IMPORT_STEPS = ["File", "Review", "Credentials", "Folders"];

interface StepNav {
	onBack?: () => void;
	onNext?: () => void;
}

export function RawError({ children }: { children: string }) {
	return (
		<code className="block rounded bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
			{children}
		</code>
	);
}

export interface ChosenFile {
	name: string;
	size: number;
}

/**
 * Where the file has got to. `reading` is the browser pulling it off disk;
 * `checking` is the dry run in flight at the server. They are different waits
 * with different failures, and a control that cannot tell them apart lands the
 * reader on a button that looks ready before there is anything to send.
 */
export type ChooseFileState = "idle" | "dragging" | "reading" | "checking";

export function StepChooseFile({
	state = "idle",
	file,
	ready = false,
	failure,
	onChoose,
	onDragStateChange,
	onNext,
}: {
	state?: ChooseFileState;
	file?: ChosenFile;
	/**
	 * A document has parsed and is there to send. Without it "Check the file"
	 * would offer to send what the browser has not finished reading, or what
	 * turned out not to be a configuration at all.
	 */
	ready?: boolean;
	/** A file that could not even be read as a configuration document. */
	failure?: FailureCopy;
	onChoose?: (file: File) => void;
	onDragStateChange?: (dragging: boolean) => void;
} & StepNav) {
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const dragging = state === "dragging";
	const reading = state === "reading";
	const checking = state === "checking";
	const busy = reading || checking;

	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		onDragStateChange?.(false);
		const dropped = event.dataTransfer.files.item(0);
		if (dropped) onChoose?.(dropped);
	};

	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={0}
			title="Import a config file"
			subtitle="Accounts, folder roles, rules, senders and appearance — everything except passwords."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						Nothing is written until you have seen what will change.
					</span>
					<Button
						variant="primary"
						disabled={busy || !ready}
						icon={
							busy ? <Loader2 className="size-3.5 animate-spin" /> : undefined
						}
						onClick={onNext}
					>
						{reading ? "Reading…" : checking ? "Checking…" : "Check the file"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{failure && (
					<div className="space-y-2">
						<Banner tone="danger">{failure.title}</Banner>
						<p className="text-sm text-fg">{failure.explanation}</p>
						<p className="text-sm text-fg-muted">{failure.fix}</p>
						<RawError>{failure.raw}</RawError>
					</div>
				)}
				{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the drop target's keyboard and pointer route is the Choose file control inside it; the drag handlers add a second way in, never the only one */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: same — dropping is an alternative to a control that is already focusable and labelled */}
				<div
					onDragOver={(event) => {
						event.preventDefault();
						onDragStateChange?.(true);
					}}
					onDragLeave={() => onDragStateChange?.(false)}
					onDrop={handleDrop}
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
					<input
						ref={inputRef}
						id={inputId}
						type="file"
						accept="application/json,.json"
						className="sr-only"
						onChange={(event) => {
							const picked = event.target.files?.item(0);
							if (picked) onChoose?.(picked);
						}}
					/>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => inputRef.current?.click()}
					>
						Choose file
					</Button>
				</div>
				{file && (
					<div className="flex items-start gap-3 rounded-sm border border-line px-3 py-2.5">
						<FileJson className="mt-0.5 size-4 shrink-0 text-fg-muted" />
						<div className="min-w-0">
							<p className="truncate text-sm text-fg">{file.name}</p>
							<p className="mt-0.5 text-xs text-fg-subtle">
								{formatFileSize(file.size)} ·{" "}
								{reading
									? "reading it from disk"
									: checking
										? "checking it against this instance"
										: ready
											? "ready to check — nothing has been sent yet"
											: "not a configuration this instance can read"}
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

function VerdictSummary({ sections }: { sections: ReportSection[] }) {
	const counts = countVerdicts(
		sections.flatMap((section) =>
			section.entries.map((entry) => ({
				section: section.id,
				key: entry.label,
				verdict: entry.verdict,
			})),
		),
	);
	return (
		<div className="flex flex-wrap gap-1.5">
			{(["created", "updated", "unchanged", "skipped", "rejected"] as const)
				.filter((verdict) => counts[verdict] > 0)
				.map((verdict) => (
					<Badge key={verdict} tone={verdictTone[verdict]} dot>
						{counts[verdict]} {verdict}
					</Badge>
				))}
		</div>
	);
}

function SectionReport({ section }: { section: ReportSection }) {
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
	sections,
	fileName,
	warnings = [],
	applying = false,
	onBack,
	onNext,
}: {
	sections: ReportSection[];
	fileName: string;
	/** Non-blocking notes worth reading before the write, e.g. a missing folder. */
	warnings?: string[];
	applying?: boolean;
} & StepNav) {
	const counts = countVerdicts(
		sections.flatMap((section) =>
			section.entries.map((entry) => ({
				section: section.id,
				key: entry.label,
				verdict: entry.verdict,
			})),
		),
	);
	const willWrite = counts.created + counts.updated;
	const held = counts.skipped + counts.rejected;
	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={1}
			title="What this file will change"
			subtitle={`${fileName} · nothing has been written yet.`}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Choose another file
					</Button>
					<Button
						variant="primary"
						disabled={applying}
						icon={
							applying ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : undefined
						}
						onClick={onNext}
					>
						{applying ? "Importing…" : `Import ${willWrite} changes`}
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
				{warnings.length > 0 && (
					<ul className="space-y-1 text-xs text-warning">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
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
	held,
	onChoose,
	onBack,
	onNext,
}: {
	choice?: "abort" | "merge";
	/** What the instance already holds, as the 409 counted it. */
	held: string;
	onChoose?: (choice: "abort" | "merge") => void;
} & StepNav) {
	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={1}
			title="This instance already has configuration"
			subtitle={held}
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
						onSelect={() => onChoose?.("abort")}
					/>
					<ConnectorTile
						name="Merge the file in"
						description="Adds what is missing and updates what differs. Existing accounts keep their server settings."
						icon={<Merge className="size-5" />}
						selected={choice === "merge"}
						onSelect={() => onChoose?.("merge")}
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

export type CredentialState = "needed" | "entered" | "failed";

export interface ImportedAccount {
	accountId: string;
	address: string;
	displayName: string;
	connector: "imap" | "microsoft";
	server: string;
	state: CredentialState;
	/** What went wrong on the last attempt, and the likely fix. */
	failure?: string;
}

function credentialBadge(state: CredentialState): ReactNode {
	if (state === "entered") return <Badge tone="positive">ready</Badge>;
	if (state === "failed") return <Badge tone="danger">sign-in failed</Badge>;
	return <Badge tone="danger">credentials needed</Badge>;
}

export function AccountCredentialsList({
	accounts,
	busyAccountId,
	onOpen,
}: {
	accounts: ImportedAccount[];
	/** The account whose OAuth redirect is in flight. */
	busyAccountId?: string;
	onOpen?: (account: ImportedAccount) => void;
}) {
	return (
		<ul className="divide-y divide-line">
			{accounts.map((account) => (
				<li
					key={account.accountId}
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
							disabled={busyAccountId === account.accountId}
							icon={
								busyAccountId === account.accountId ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : account.connector === "microsoft" ? (
									<Inbox className="size-3.5" />
								) : (
									<KeyRound className="size-3.5" />
								)
							}
							onClick={() => onOpen?.(account)}
						>
							{busyAccountId === account.accountId
								? "Redirecting…"
								: account.connector === "microsoft"
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
	accounts,
	busyAccountId,
	error,
	onOpen,
	onNext,
}: {
	accounts: ImportedAccount[];
	busyAccountId?: string;
	error?: string;
	onOpen?: (account: ImportedAccount) => void;
} & StepNav) {
	const outstanding = accounts.filter(
		(account) => account.state !== "entered",
	).length;
	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={2}
			title="These accounts need credentials"
			subtitle="The config file carries servers and settings. Passwords and Microsoft sign-ins it deliberately leaves out."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						{outstanding > 0
							? "Settings › Accounts keeps asking until every account is signed in."
							: "Every account can sync."}
					</span>
					<Button variant="primary" onClick={onNext}>
						{outstanding > 0 ? "Finish later" : "All accounts connected"}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{error && <Banner tone="danger">{error}</Banner>}
				{outstanding > 0 && (
					<Banner tone="danger">
						{outstanding} of {accounts.length} accounts cannot sync yet. They
						stay listed in Settings, marked like this, until you sign in — no
						mail arrives for them in the meantime.
					</Banner>
				)}
				<AccountCredentialsList
					accounts={accounts}
					busyAccountId={busyAccountId}
					onOpen={onOpen}
				/>
			</div>
		</WizardShell>
	);
}

export function StepAccountReconnectMicrosoft({
	account,
	position,
	total,
	error,
	busy = false,
	onBack,
	onNext,
}: {
	account: ImportedAccount;
	position: number;
	total: number;
	error?: string;
	busy?: boolean;
} & StepNav) {
	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={2}
			title={`Reconnect ${account.address}`}
			subtitle={`Account ${position} of ${total} · Microsoft 365`}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button
						variant="primary"
						disabled={busy}
						icon={
							busy ? <Loader2 className="size-3.5 animate-spin" /> : undefined
						}
						onClick={onNext}
					>
						{busy ? "Redirecting…" : "Sign in with Microsoft"}
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

export function StepPendingFolders({
	folders,
	onNext,
}: { folders: PendingFolder[] } & StepNav) {
	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={3}
			title={folders.length > 0 ? "Waiting on folders" : "Import finished"}
			subtitle={
				folders.length > 0
					? "The config names folders this server has not shown us yet."
					: "Everything in the file landed, and every folder it named resolved."
			}
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
				{folders.length > 0 ? (
					<>
						<Banner tone="warning">
							{folders.length} settings are imported but switched off. Each
							turns itself on the moment its folder appears — nothing was
							dropped. If a folder never appears, create it in your mail client,
							or edit the setting in Settings → Senders & Rules.
						</Banner>
						<div className="flex items-center gap-2 text-xs text-fg-muted">
							<FolderClock className="size-4" />
							Folder discovery runs with every sync of the account.
						</div>
						<div className="divide-y divide-line">
							{folders.map((folder) => (
								<CheckRow
									key={`${folder.accountId ?? ""}-${folder.path}-${folder.waitingFor}`}
									label={folder.path}
									detail={folder.waitingFor}
									state="pending"
								/>
							))}
						</div>
					</>
				) : (
					<Banner tone="success">
						Every account, rule, label and sender in the file is live on this
						instance.
					</Banner>
				)}
			</div>
		</WizardShell>
	);
}

export function StepFileRejected({
	failure,
	onBack,
}: { failure: FailureCopy } & StepNav) {
	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={0}
			title={failure.title}
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
				<Banner tone="danger">{failure.explanation}</Banner>
				<p className="text-sm text-fg">{failure.fix}</p>
				<RawError>{failure.raw}</RawError>
			</div>
		</WizardShell>
	);
}

/**
 * A section nobody can vouch for reads as failed, never as pending. Pending
 * says "still coming"; this section is finished and its outcome is unknown,
 * which is the row the reader has to go and check for themselves.
 */
function resultState(state: SectionResult["state"]) {
	if (state === "landed") return "ok" as const;
	if (state === "failed" || state === "unknown") return "failed" as const;
	return "pending" as const;
}

export function StepPartialImport({
	results,
	message,
	raw,
	onBack,
	onNext,
}: {
	results: SectionResult[];
	/** The server's own account of what survived, which only it knows. */
	message: string;
	raw: string;
} & StepNav) {
	const landed = results.filter((result) => result.state === "landed").length;
	const unknown = results.some((result) => result.state === "unknown");
	return (
		<WizardShell
			steps={IMPORT_STEPS}
			activeStep={1}
			title="The import stopped part-way"
			subtitle={
				unknown
					? "It did not say how far it got, so check Settings before importing again."
					: `${landed} of ${results.length} sections landed.`
			}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Choose another file
					</Button>
					<Button variant="primary" onClick={onNext}>
						Retry the rest
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<Banner tone="danger">{message}</Banner>
				<p className="text-sm text-fg-muted">
					Retrying is safe: an import folds into what is already here rather
					than replacing it, so what landed is recognised and left alone.
				</p>
				<div className="divide-y divide-line">
					{results.map((result) => (
						<CheckRow
							key={result.section}
							label={result.title}
							detail={result.detail}
							state={resultState(result.state)}
						/>
					))}
				</div>
				<RawError>{raw}</RawError>
			</div>
		</WizardShell>
	);
}
