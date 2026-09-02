/**
 * Importing a configuration file, end to end (#1021 stage 5).
 *
 * The walk is: pick a file, dry-run it (`mode: validate`, which writes nothing
 * and returns the report an apply would), read the per-item verdicts, settle a
 * 409 against a non-empty instance, apply, then hand over the credentials the
 * file deliberately does not carry — a password for a password account, a fresh
 * Microsoft grant for an OAuth one. The folders IMAP has not produced yet are
 * named at the end, because they are waiting rather than lost.
 *
 * The step is component state and not URL state. The picked file is a `File`
 * handle that no reload can bring back, so a step in the address would restore
 * a screen with nothing behind it (url-state.md R6) — the same reason
 * `OnboardingWizard` keeps its own step in state.
 */

import {
	accountDetailOperationsUpdateAccountMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
	configOperationsImportConfigMutation,
	microsoftOAuthOperationsMicrosoftOAuthStartMutation,
	syncOperationsTriggerSyncMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type {
	RemitImapAccountResponse,
	RemitImapConfigImportReport,
} from "@remit/api-http-client/types.gen.ts";
import { Banner } from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
	REDIRECT_STALL_MESSAGE,
	useRedirectEnded,
} from "@/hooks/useRedirectEnded";
import { useReturnFromRedirect } from "@/hooks/useReturnFromRedirect";
import type { SecurityMode } from "@/lib/autodiscovery";
import {
	type ConfigDocument,
	type FailureCopy,
	groupReportSections,
	type ImportConflict,
	type PendingFolder,
	pendingFolders,
	readConfigText,
	readConflict,
	readFailure,
	sectionResults,
	WRITE_FAILURE_CODE,
	writeFailure,
} from "@/lib/config-import";
import { softErrorStatuses } from "@/lib/error-classifier";
import {
	ConnectionTestStep,
	CredentialsStep,
	type ServerConfig,
} from "../onboarding/credential-steps";
import {
	type ChosenFile,
	IMPORT_STEPS,
	type ImportedAccount,
	StepAccountReconnectMicrosoft,
	StepChooseFile,
	StepCredentialsOverview,
	StepDryRunReport,
	StepFileRejected,
	StepInstanceAlreadyConfigured,
	StepPartialImport,
	StepPendingFolders,
} from "./steps";

type Step =
	| "file"
	| "rejected"
	| "review"
	| "conflict"
	| "partial"
	| "credentials"
	| "account-password"
	| "account-test"
	| "account-oauth"
	| "folders";

const securityOf = (tls: boolean, startTls: boolean): SecurityMode =>
	tls ? "tls" : startTls ? "starttls" : "none";

const serverOf = (account: RemitImapAccountResponse): ServerConfig => ({
	host: account.imapHost,
	port: account.imapPort,
	security: securityOf(account.imapTls, account.imapStartTls),
});

const smtpOf = (account: RemitImapAccountResponse): ServerConfig => ({
	host: account.smtpEnabled ? account.smtpHost : "",
	port: account.smtpPort,
	security: securityOf(account.smtpTls, account.smtpStartTls),
});

/**
 * An account the import landed, as the credentials screen reads it.
 *
 * `connectionState` is the server's eventual truth and not this screen's: the
 * import writes `credentials_missing`, and only the imap worker clears it, on
 * its next connection, minutes later. Reading readiness off that field alone
 * left an account the reader had just signed in to sitting red with an "Enter
 * password" button, so a credential this wizard verified and stored counts here
 * and the field catches up behind it.
 */
const asImportedAccount = (
	account: RemitImapAccountResponse,
	failure: string | undefined,
	verified: boolean,
): ImportedAccount => {
	const connector =
		account.authType === "oauthMicrosoft" ? "microsoft" : "imap";
	const waiting =
		!verified &&
		(connector === "microsoft"
			? account.connectionState === "reauth_required"
			: account.connectionState === "credentials_missing");
	return {
		accountId: account.accountId,
		address: account.email,
		displayName: account.displayName?.trim() || account.email,
		connector,
		server: `${account.imapHost}:${account.imapPort}`,
		state: failure ? "failed" : waiting ? "needed" : "entered",
		failure,
	};
};

const heldSummary = (details: Record<string, string> | undefined): string => {
	if (!details) return "This instance already holds configuration of its own.";
	const parts = (
		[
			["accounts", "account"],
			["labels", "label"],
			["filters", "rule"],
			["addressFlags", "flagged sender"],
		] as const
	)
		.map(([key, noun]) => ({ count: Number(details[key] ?? 0), noun }))
		.filter((part) => part.count > 0)
		.map((part) => `${part.count} ${part.noun}${part.count === 1 ? "" : "s"}`);
	if (parts.length === 0) {
		return "This instance already holds configuration of its own.";
	}
	return `${parts.join(", ")} are set up here already.`;
};

const errorText = (error: unknown, fallback: string): string => {
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error !== null) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return fallback;
};

export interface ConfigImportWizardProps {
	/**
	 * Leaving the wizard. `imported` only where an apply actually wrote — an
	 * abandoned 409 and a wizard closed on a rejected file are both `abandoned`,
	 * so nothing downstream records an import that never happened.
	 */
	onDone: (outcome: "imported" | "abandoned") => void;
}

export function ConfigImportWizard({ onDone }: ConfigImportWizardProps) {
	const queryClient = useQueryClient();

	const [step, setStep] = useState<Step>("file");
	const [dragging, setDragging] = useState(false);
	const [readingFile, setReadingFile] = useState(false);
	const [file, setFile] = useState<ChosenFile | undefined>(undefined);
	const [document, setDocument] = useState<ConfigDocument | undefined>(
		undefined,
	);
	const [readFailureCopy, setReadFailureCopy] = useState<
		FailureCopy | undefined
	>(undefined);
	const [report, setReport] = useState<RemitImapConfigImportReport | undefined>(
		undefined,
	);
	const [onExisting, setOnExisting] = useState<"abort" | "merge">("abort");
	const [conflictChoice, setConflictChoice] = useState<
		"abort" | "merge" | undefined
	>(undefined);
	const [conflict, setConflict] = useState<ImportConflict | undefined>(
		undefined,
	);
	const [needingCredentials, setNeedingCredentials] = useState<string[]>([]);
	/** Accounts this wizard signed in and stored a credential for. */
	const [verifiedAccountIds, setVerifiedAccountIds] = useState<string[]>([]);
	const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
	const [credentials, setCredentials] = useState({
		username: "",
		password: "",
	});
	const [accountFailures, setAccountFailures] = useState<
		Record<string, string>
	>({});
	const [overviewError, setOverviewError] = useState<string | undefined>(
		undefined,
	);
	const [reconnectingAccountId, setReconnectingAccountId] = useState<
		string | null
	>(null);
	const [importedFolders, setImportedFolders] = useState<PendingFolder[]>([]);

	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		enabled: needingCredentials.length > 0 || step === "folders",
	});

	const accountsById = useMemo(() => {
		const index = new Map<string, RemitImapAccountResponse>();
		for (const account of config?.accounts ?? []) {
			index.set(account.accountId, account);
		}
		return index;
	}, [config]);

	const accounts: ImportedAccount[] = useMemo(
		() =>
			needingCredentials
				.map((accountId) => accountsById.get(accountId))
				.filter((account): account is RemitImapAccountResponse => !!account)
				.map((account) =>
					asImportedAccount(
						account,
						accountFailures[account.accountId],
						verifiedAccountIds.includes(account.accountId),
					),
				),
		[needingCredentials, accountsById, accountFailures, verifiedAccountIds],
	);

	const activeAccount = activeAccountId
		? accountsById.get(activeAccountId)
		: undefined;
	const activePosition = activeAccountId
		? needingCredentials.indexOf(activeAccountId) + 1
		: 0;

	// Each of these owns exactly the refusals it renders, and nothing else. A
	// blanket `softError` would also swallow the 401 that has to escalate to the
	// signed-out state, and a 5xx escalates regardless of what is asked for here.
	const importMutation = useMutation({
		...configOperationsImportConfigMutation(),
		// 409 `config_not_empty` is not a fault: it is the abort-or-merge screen.
		meta: softErrorStatuses(409),
	});
	const updateAccount = useMutation({
		...accountDetailOperationsUpdateAccountMutation(),
		// The account is gone (404) or is not this configuration's (403); the
		// credentials row states either where it stands.
		meta: softErrorStatuses(403, 404),
	});
	const triggerSync = useMutation(syncOperationsTriggerSyncMutation());
	// No meta: `POST /oauth/microsoft/start` declares no refusal. It answers 5xx
	// when the tenant secret is missing, which must reach the fatal page rather
	// than a wizard banner, and a transport failure is soft already — which is
	// the failure the reconnect screen's own error line renders.
	const oauthStart = useMutation(
		microsoftOAuthOperationsMicrosoftOAuthStartMutation(),
	);

	// Microsoft hands the finished sign-in back to whichever window the platform
	// picks, which need not be this one. Every return to this window re-reads the
	// accounts, so a row states what the server says rather than what this window
	// last saw.
	useReturnFromRedirect(reconnectingAccountId !== null, () => {
		queryClient.invalidateQueries({
			queryKey: configOperationsGetConfigQueryKey(),
		});
		setReconnectingAccountId(null);
	});

	const markRedirectStarted = useRedirectEnded((end) => {
		setReconnectingAccountId(null);
		if (end === "stalled") setOverviewError(REDIRECT_STALL_MESSAGE);
	});

	const handleChoose = useCallback((picked: File) => {
		setDragging(false);
		setReadingFile(true);
		setFile({ name: picked.name, size: picked.size });
		setReadFailureCopy(undefined);
		setDocument(undefined);
		picked
			.text()
			.then((text) => readConfigText(picked.name, picked.size, text))
			.then((result) => {
				setReadingFile(false);
				if (!result.ok) {
					setReadFailureCopy(result.failure);
					return;
				}
				setDocument(result.document);
			})
			.catch((cause: unknown) => {
				setReadingFile(false);
				setReadFailureCopy({
					title: "That file could not be read",
					explanation: `The browser could not read ${picked.name} from disk, so nothing was sent.`,
					fix: "Check the file is still there and try again.",
					raw: errorText(cause, "the file read was refused"),
				});
			});
	}, []);

	const runImport = useCallback(
		(mode: "validate" | "apply", existing: "abort" | "merge") => {
			if (!document) return;
			setConflict(undefined);
			importMutation.mutate(
				{ body: { mode, onExisting: existing, document } },
				{
					onSuccess: (answer) => {
						setReport(answer);
						if (readFailure(answer)) {
							setStep("rejected");
							return;
						}
						if (writeFailure(answer)) {
							setStep("partial");
							return;
						}
						if (mode === "validate") {
							setStep("review");
							return;
						}
						setImportedFolders(pendingFolders(answer));
						queryClient.invalidateQueries({
							queryKey: configOperationsGetConfigQueryKey(),
						});
						if (answer.accountsNeedingCredentials.length > 0) {
							setNeedingCredentials([...answer.accountsNeedingCredentials]);
							setStep("credentials");
							return;
						}
						setStep("folders");
					},
					onError: (cause: unknown) => {
						const refused = readConflict(cause);
						if (refused) {
							setConflict(refused);
							setConflictChoice(undefined);
							setStep("conflict");
							return;
						}
						setReadFailureCopy({
							title: "The import could not be sent",
							explanation:
								"The request to this instance failed before it produced a report, so nothing was written.",
							fix: "Check your connection and try again.",
							raw: errorText(cause, "POST /config/import failed"),
						});
						setStep("file");
					},
				},
			);
		},
		[document, importMutation, queryClient],
	);

	const openAccount = useCallback(
		(account: ImportedAccount) => {
			setActiveAccountId(account.accountId);
			setOverviewError(undefined);
			if (account.connector === "microsoft") {
				setStep("account-oauth");
				return;
			}
			const stored = accountsById.get(account.accountId);
			setCredentials({
				username: stored?.username || account.address,
				password: "",
			});
			setStep("account-password");
		},
		[accountsById],
	);

	const handleCredentialsVerified = useCallback(() => {
		if (!activeAccountId) return;
		updateAccount.mutate(
			{
				path: { accountId: activeAccountId },
				body: { password: credentials.password, isActive: true },
			},
			{
				onSuccess: () => {
					triggerSync.mutate({ path: { accountId: activeAccountId } });
					setVerifiedAccountIds((ids) =>
						ids.includes(activeAccountId) ? ids : [...ids, activeAccountId],
					);
					setAccountFailures((failures) => {
						const next = { ...failures };
						delete next[activeAccountId];
						return next;
					});
					queryClient.invalidateQueries({
						queryKey: configOperationsGetConfigQueryKey(),
					});
					setCredentials({ username: "", password: "" });
					setActiveAccountId(null);
					setStep("credentials");
				},
				onError: (cause: unknown) => {
					setAccountFailures((failures) => ({
						...failures,
						[activeAccountId]: errorText(
							cause,
							"The password was verified but could not be stored. Try again.",
						),
					}));
					setActiveAccountId(null);
					setStep("credentials");
				},
			},
		);
	}, [
		activeAccountId,
		credentials.password,
		queryClient,
		triggerSync,
		updateAccount,
	]);

	const startReconnect = useCallback(() => {
		if (!activeAccount) return;
		setReconnectingAccountId(activeAccount.accountId);
		oauthStart.mutate(
			{ body: { email: activeAccount.email } },
			{
				onSuccess: (data) => {
					markRedirectStarted();
					window.location.assign(data.authorizationUrl);
				},
				onError: (cause: unknown) => {
					setReconnectingAccountId(null);
					setAccountFailures((failures) => ({
						...failures,
						[activeAccount.accountId]: errorText(
							cause,
							"Microsoft sign-in could not be started.",
						),
					}));
					setActiveAccountId(null);
					setStep("credentials");
				},
			},
		);
	}, [activeAccount, markRedirectStarted, oauthStart]);

	const handleChangeCredentials = useCallback(
		(username: string, password: string) =>
			setCredentials({ username, password }),
		[],
	);

	/**
	 * What is still waiting when the wizard finishes: the warnings the apply
	 * produced, plus whatever the binder has not resolved since — `pendingImport`
	 * on GET /config is the live answer, and the warnings name which setting each
	 * path belongs to.
	 */
	const foldersStillPending: PendingFolder[] = useMemo(() => {
		const live = config?.pendingImport?.folderPaths;
		if (!live) return importedFolders;
		const named = new Set(live);
		const known = importedFolders.filter((folder) => named.has(folder.path));
		const unnamed = live
			.filter((path) => !importedFolders.some((folder) => folder.path === path))
			.map((path) => ({ path, waitingFor: "An imported setting" }));
		return [...known, ...unnamed];
	}, [config, importedFolders]);

	const goToFile = useCallback(() => {
		setReport(undefined);
		setConflict(undefined);
		setReadFailureCopy(undefined);
		setFile(undefined);
		setDocument(undefined);
		setOnExisting("abort");
		setStep("file");
	}, []);

	switch (step) {
		case "file":
			return (
				<StepChooseFile
					state={
						readingFile
							? "reading"
							: importMutation.isPending
								? "checking"
								: dragging
									? "dragging"
									: "idle"
					}
					file={file}
					ready={document !== undefined}
					failure={readFailureCopy}
					onChoose={handleChoose}
					onDragStateChange={setDragging}
					onNext={() => runImport("validate", onExisting)}
				/>
			);

		case "rejected":
			return (
				<StepFileRejected
					failure={
						(report && readFailure(report)) ??
						readFailureCopy ?? {
							title: "The file could not be imported",
							explanation: "The import was refused and nothing was written.",
							fix: "Re-export the configuration and try again.",
							raw: "no error was reported",
						}
					}
					onBack={goToFile}
				/>
			);

		case "conflict":
			return (
				<StepInstanceAlreadyConfigured
					choice={conflictChoice}
					held={heldSummary(conflict?.details)}
					onChoose={setConflictChoice}
					onBack={goToFile}
					onNext={() => {
						if (conflictChoice === "abort") {
							onDone("abandoned");
							return;
						}
						setOnExisting("merge");
						runImport("validate", "merge");
					}}
				/>
			);

		case "review":
			return (
				<StepDryRunReport
					sections={groupReportSections(report?.items ?? [])}
					fileName={file?.name ?? "the config file"}
					warnings={(report?.warnings ?? []).map((warning) => warning.message)}
					applying={importMutation.isPending}
					onBack={goToFile}
					onNext={() => runImport("apply", onExisting)}
				/>
			);

		case "partial": {
			if (!report) return <StepMissingReport onBack={goToFile} />;
			const failed = writeFailure(report);
			return (
				<StepPartialImport
					results={sectionResults(report)}
					message={failed?.message ?? "The import stopped before it finished."}
					raw={`${failed?.code ?? WRITE_FAILURE_CODE}: ${failed?.message ?? "no message"}`}
					nothingLanded={!report.applied}
					onBack={goToFile}
					onNext={() => runImport("apply", "merge")}
				/>
			);
		}

		case "credentials":
			return (
				<StepCredentialsOverview
					accounts={accounts}
					busyAccountId={reconnectingAccountId ?? undefined}
					error={overviewError}
					onOpen={openAccount}
					// No way back: the apply has run, and the step behind this one is the
					// dry run whose primary action would apply the same file again to an
					// instance that is no longer empty.
					onNext={() => setStep("folders")}
				/>
			);

		case "account-password":
			if (!activeAccount) {
				return <StepMissingAccount onBack={() => onDone("abandoned")} />;
			}
			return (
				<CredentialsStep
					steps={IMPORT_STEPS}
					activeStep={2}
					title={`Sign in to ${activeAccount.email}`}
					subtitle={`Account ${activePosition} of ${needingCredentials.length} · ${activeAccount.imapHost}:${activeAccount.imapPort}`}
					email={activeAccount.email}
					username={credentials.username}
					password={credentials.password}
					error={accountFailures[activeAccount.accountId]}
					continueLabel="Test and continue"
					notice={
						<div className="flex items-center gap-2 text-xs text-fg-muted">
							<Server className="size-3.5" />
							Server settings came from the config file — edit them in Settings
							if they are wrong.
						</div>
					}
					onContinue={() => setStep("account-test")}
					onBack={() => {
						setActiveAccountId(null);
						setStep("credentials");
					}}
					onChange={handleChangeCredentials}
				/>
			);

		case "account-test":
			if (!activeAccount) {
				return <StepMissingAccount onBack={() => onDone("abandoned")} />;
			}
			return (
				<ConnectionTestStep
					steps={IMPORT_STEPS}
					activeStep={2}
					email={activeAccount.email}
					imapConfig={serverOf(activeAccount)}
					smtpConfig={smtpOf(activeAccount)}
					username={credentials.username}
					password={credentials.password}
					credentialsBackLabel="Back to the password"
					serversBackLabel="Back to the password"
					successLabel="Save and continue"
					onSuccess={handleCredentialsVerified}
					onBackToCredentials={() => setStep("account-password")}
					onBackToServers={() => setStep("account-password")}
				/>
			);

		case "account-oauth":
			if (!activeAccount) {
				return <StepMissingAccount onBack={() => onDone("abandoned")} />;
			}
			return (
				<StepAccountReconnectMicrosoft
					account={asImportedAccount(
						activeAccount,
						accountFailures[activeAccount.accountId],
						verifiedAccountIds.includes(activeAccount.accountId),
					)}
					position={activePosition}
					total={needingCredentials.length}
					error={accountFailures[activeAccount.accountId]}
					busy={reconnectingAccountId === activeAccount.accountId}
					onBack={() => {
						setActiveAccountId(null);
						setStep("credentials");
					}}
					onNext={startReconnect}
				/>
			);

		case "folders":
			return (
				<StepPendingFolders
					folders={foldersStillPending}
					onNext={() => onDone("imported")}
				/>
			);
	}
}

function DeadEnd({
	children,
	label,
	onBack,
}: {
	children: string;
	label: string;
	onBack: () => void;
}) {
	return (
		<div className="mx-auto max-w-lg p-6">
			<Banner tone="danger">{children}</Banner>
			<button
				type="button"
				className="mt-3 text-sm text-accent underline"
				onClick={onBack}
			>
				{label}
			</button>
		</div>
	);
}

/**
 * The account the wizard was about to ask for is gone from GET /config — it was
 * deleted, or this configuration is not the one that was imported into. Saying
 * so beats a blank screen the reader cannot leave.
 */
function StepMissingAccount({ onBack }: { onBack: () => void }) {
	return (
		<DeadEnd label="Go to inbox" onBack={onBack}>
			That account is no longer in this instance's configuration, so there is
			nothing left to sign in to. Open Settings › Accounts to see what is here.
		</DeadEnd>
	);
}

/** The partial-import screen with no report behind it — only reachable from a bug. */
function StepMissingReport({ onBack }: { onBack: () => void }) {
	return (
		<DeadEnd label="Choose another file" onBack={onBack}>
			The import stopped but produced no report, so nothing here can say what it
			wrote. Open Settings to see what this instance holds before importing
			again.
		</DeadEnd>
	);
}
