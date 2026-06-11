/**
 * OnboardingWizard — full 7-step onboarding flow.
 *
 * Steps: Welcome → Connector → Address → Servers → Credentials → Test → Sync
 *
 * Entry points:
 *  - First-run (zero accounts): full-screen wizard via /onboarding route
 *  - Settings "Add account": steps 2-7 embedded in the settings content area
 *
 * Backend deps status:
 *  - POST /accounts — CREATE. Exists.
 *  - POST /accounts/test-connection — Exists.
 *  - GET /accounts/{accountId}/sync/status — Exists (#431 syncPhase).
 *  - GET /autodiscovery?email=… — NOT YET IMPLEMENTED (TypeSpec-first, future).
 *    Client-side autodiscovery (provider table + Mozilla autoconfig) used instead.
 */

import {
	accountOperationsCreateAccountMutation,
	accountOperationsTestConnectionMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
	syncOperationsGetSyncStatusOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	Badge,
	Button,
	CheckRow,
	ConnectorTile,
	Input,
	Kbd,
	Select,
	WizardShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Inbox, Loader2, Mail, Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
// useRef is kept for hasRunRef / hasCreatedRef guards — not for DOM refs
import {
	type DiscoveryResult,
	discoverSettings,
	getAppPasswordUrl,
	getDiscoveryStatusMessage,
	type SecurityMode,
} from "../../lib/autodiscovery.js";
import { computeSmtpAutoFill } from "../settings/account-form-helpers.js";

/* ------------------------------------------------------------------ */
/* Wizard step definitions                                            */
/* ------------------------------------------------------------------ */

type WizardStep =
	| "welcome"
	| "connector"
	| "address"
	| "servers"
	| "credentials"
	| "test"
	| "sync";

const STEP_LABELS = [
	"Connector",
	"Address",
	"Servers",
	"Credentials",
	"Test",
	"Sync",
];

// Maps WizardStep to zero-based index in the rail (welcome hides rail)
const STEP_INDEX: Record<WizardStep, number> = {
	welcome: 0,
	connector: 0,
	address: 1,
	servers: 2,
	credentials: 3,
	test: 4,
	sync: 5,
};

/* ------------------------------------------------------------------ */
/* State shapes                                                        */
/* ------------------------------------------------------------------ */

interface ServerConfig {
	host: string;
	port: number;
	security: SecurityMode;
}

interface WizardState {
	email: string;
	imapConfig: ServerConfig;
	smtpConfig: ServerConfig;
	username: string;
	password: string;
	discoveryResult: DiscoveryResult | null;
	/** True if autodiscovery succeeded (affects subtitle copy) */
	discovered: boolean;
	/** Account ID created at step 7 */
	createdAccountId: string | null;
}

const DEFAULT_IMAP: ServerConfig = { host: "", port: 993, security: "tls" };
const DEFAULT_SMTP: ServerConfig = {
	host: "",
	port: 587,
	security: "starttls",
};

type TestPhase =
	| "idle"
	| "running"
	| "success"
	| "auth-failure"
	| "network-failure";

interface TestResult {
	imapState: "pending" | "running" | "ok" | "failed";
	smtpState: "pending" | "running" | "ok" | "failed";
	imapDetail?: string;
	smtpDetail?: string;
	rawError?: string;
	phase: TestPhase;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function FieldLabel({ children }: { children: string }) {
	return (
		<span className="mb-1 block text-xs font-medium text-fg-muted">
			{children}
		</span>
	);
}

function SecuritySelect({
	value,
	onChange,
}: {
	value: SecurityMode;
	onChange: (v: SecurityMode) => void;
}) {
	return (
		<Select
			value={value}
			onChange={(e) => onChange(e.target.value as SecurityMode)}
		>
			<option value="tls">TLS/SSL</option>
			<option value="starttls">STARTTLS</option>
			<option value="none">None (insecure)</option>
		</Select>
	);
}

function securityToApi(security: SecurityMode): {
	tls: boolean;
	startTls: boolean;
} {
	return {
		tls: security === "tls",
		startTls: security === "starttls",
	};
}

/* ------------------------------------------------------------------ */
/* Individual step components                                         */
/* ------------------------------------------------------------------ */

function StepWelcome({ onStart }: { onStart: () => void }) {
	// Keyboard: Enter advances
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter") onStart();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onStart]);

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={0}
			hideSteps
			title="Welcome to Remit"
			subtitle="One inbox for all your mail, with context about every message."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						<Kbd>Enter</Kbd> to continue
					</span>
					<Button variant="primary" onClick={onStart}>
						Add your first account
					</Button>
				</>
			}
		>
			<div className="flex flex-col items-start py-5">
				<span className="flex size-14 items-center justify-center rounded-md bg-accent-soft">
					<Mail className="size-7 text-accent" />
				</span>
				<p className="mt-5 max-w-sm text-sm leading-relaxed text-fg-muted">
					Remit syncs your existing mailboxes and tells you who is really
					writing to you — sender history, authenticity checks, and similar
					messages, right next to every email.
				</p>
			</div>
		</WizardShell>
	);
}

function StepConnector({
	onContinue,
	onBack,
	showBack,
}: {
	onContinue: () => void;
	onBack: () => void;
	showBack: boolean;
}) {
	// IMAP is the only active connector; advance immediately on Continue
	// Keyboard: Enter advances, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter") onContinue();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onContinue, onBack]);

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.connector}
			title="How does this account connect?"
			subtitle="IMAP works with any provider today. OAuth connectors are on the way."
			footer={
				<>
					{showBack ? (
						<Button variant="ghost" onClick={onBack}>
							Back
						</Button>
					) : (
						<span />
					)}
					<Button variant="primary" onClick={onContinue}>
						Continue with IMAP
					</Button>
				</>
			}
		>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<ConnectorTile
					name="IMAP / SMTP"
					description="Any mail provider — Fastmail, iCloud, your own server."
					icon={<Server className="size-5" />}
					selected
				/>
				<ConnectorTile
					name="Gmail"
					description="Sign in with Google. No app passwords."
					icon={<AtSign className="size-5" />}
					comingSoon
				/>
				<ConnectorTile
					name="Outlook"
					description="Sign in with Microsoft 365."
					icon={<Inbox className="size-5" />}
					comingSoon
				/>
			</div>
		</WizardShell>
	);
}

function StepAddress({
	initialEmail,
	onContinue,
	onBack,
}: {
	initialEmail: string;
	onContinue: (email: string, result: DiscoveryResult | null) => void;
	onBack: () => void;
}) {
	const [email, setEmail] = useState(initialEmail);
	const [discovering, setDiscovering] = useState(false);
	const [statusMsg, setStatusMsg] = useState("");

	const handleSubmit = useCallback(async () => {
		const trimmed = email.trim();
		if (!trimmed || !trimmed.includes("@")) return;

		setDiscovering(true);
		setStatusMsg(getDiscoveryStatusMessage(trimmed));
		try {
			// Short budget — browser autoconfig fetches are CORS-blocked and
			// fall through to the heuristic; see discoverSettings docs.
			const result = await discoverSettings(trimmed);
			onContinue(trimmed, result);
		} finally {
			setDiscovering(false);
		}
	}, [email, onContinue]);

	// Keyboard: Enter submits, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter" && !discovering) void handleSubmit();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [handleSubmit, discovering, onBack]);

	const isValid = email.trim().includes("@") && email.trim().includes(".");

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.address}
			title="What's the email address?"
			subtitle="We'll detect the server settings for you."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button
						variant="primary"
						disabled={!isValid || discovering}
						onClick={() => void handleSubmit()}
					>
						Continue
					</Button>
				</>
			}
		>
			<div>
				<FieldLabel>Email address</FieldLabel>
				<Input
					icon={<AtSign className="size-4" />}
					placeholder="you@example.com"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					type="email"
					autoComplete="email"
				/>
				{discovering && (
					<div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
						<Loader2 className="size-3.5 animate-spin text-accent" />
						{statusMsg}
					</div>
				)}
			</div>
		</WizardShell>
	);
}

function StepServers({
	email,
	imapConfig,
	smtpConfig,
	discovered,
	onContinue,
	onBack,
	onChange,
}: {
	email: string;
	imapConfig: ServerConfig;
	smtpConfig: ServerConfig;
	discovered: boolean;
	onContinue: () => void;
	onBack: () => void;
	onChange: (imap: ServerConfig, smtp: ServerConfig) => void;
}) {
	const [imap, setImap] = useState<ServerConfig>(imapConfig);
	const [smtp, setSmtp] = useState<ServerConfig>(smtpConfig);

	// Propagate changes upward immediately
	useEffect(() => {
		onChange(imap, smtp);
	}, [imap, smtp, onChange]);

	const isValid = imap.host.trim() !== "" && smtp.host.trim() !== "";

	// Keyboard: Enter advances, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter" && isValid) onContinue();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [isValid, onContinue, onBack]);

	const domain = email.split("@")[1] ?? "your domain";
	const subtitle = discovered
		? "Found via autodiscovery — adjust anything that looks off."
		: `We couldn't detect settings for ${domain} — enter them manually.`;

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.servers}
			title="Confirm server settings"
			subtitle={subtitle}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" disabled={!isValid} onClick={onContinue}>
						Continue
					</Button>
				</>
			}
		>
			<div className="space-y-5">
				<fieldset>
					<legend className="flex items-center gap-2 text-sm font-semibold text-fg">
						IMAP — incoming
						{discovered && <Badge tone="positive">detected</Badge>}
					</legend>
					<div className="mt-2 grid grid-cols-[1fr_6rem_8rem] gap-2">
						<div>
							<FieldLabel>Host</FieldLabel>
							<Input
								value={imap.host}
								onChange={(e) =>
									setImap((s) => ({ ...s, host: e.target.value }))
								}
								placeholder="imap.example.com"
							/>
						</div>
						<div>
							<FieldLabel>Port</FieldLabel>
							<Input
								type="number"
								value={String(imap.port)}
								onChange={(e) =>
									setImap((s) => ({ ...s, port: Number(e.target.value) }))
								}
								placeholder="993"
							/>
						</div>
						<div>
							<FieldLabel>Security</FieldLabel>
							{/* maps to imapTls / imapStartTls on the Account API */}
							<SecuritySelect
								value={imap.security}
								onChange={(v) => setImap((s) => ({ ...s, security: v }))}
							/>
						</div>
					</div>
				</fieldset>
				<fieldset>
					<legend className="flex items-center gap-2 text-sm font-semibold text-fg">
						SMTP — outgoing
						{discovered && <Badge tone="positive">detected</Badge>}
					</legend>
					<div className="mt-2 grid grid-cols-[1fr_6rem_8rem] gap-2">
						<div>
							<FieldLabel>Host</FieldLabel>
							<Input
								value={smtp.host}
								onChange={(e) =>
									setSmtp((s) => ({ ...s, host: e.target.value }))
								}
								placeholder="smtp.example.com"
							/>
						</div>
						<div>
							<FieldLabel>Port</FieldLabel>
							<Input
								type="number"
								value={String(smtp.port)}
								onChange={(e) =>
									setSmtp((s) => ({ ...s, port: Number(e.target.value) }))
								}
								placeholder="587"
							/>
						</div>
						<div>
							<FieldLabel>Security</FieldLabel>
							{/* maps to smtpTls / smtpStartTls on the Account API */}
							<SecuritySelect
								value={smtp.security}
								onChange={(v) => setSmtp((s) => ({ ...s, security: v }))}
							/>
						</div>
					</div>
				</fieldset>
			</div>
		</WizardShell>
	);
}

function StepCredentials({
	email,
	username,
	password,
	onContinue,
	onBack,
	onChange,
}: {
	email: string;
	username: string;
	password: string;
	onContinue: () => void;
	onBack: () => void;
	onChange: (username: string, password: string) => void;
}) {
	const [localUsername, setLocalUsername] = useState(username || email);
	const [localPassword, setLocalPassword] = useState(password);

	const domain = email.split("@")[1] ?? "";
	const appPasswordUrl = getAppPasswordUrl(email);
	const isValid = localUsername.trim() !== "" && localPassword.trim() !== "";

	useEffect(() => {
		onChange(localUsername, localPassword);
	}, [localUsername, localPassword, onChange]);

	// Keyboard: Enter advances, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter" && isValid) onContinue();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [isValid, onContinue, onBack]);

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.credentials}
			title={`Sign in to ${domain || "your mail server"}`}
			subtitle="Many providers require an app password instead of your normal one."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" disabled={!isValid} onClick={onContinue}>
						Test connection
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				<div>
					<FieldLabel>Username</FieldLabel>
					<Input
						value={localUsername}
						onChange={(e) => setLocalUsername(e.target.value)}
						autoComplete="username"
					/>
				</div>
				<div>
					<FieldLabel>Password or app password</FieldLabel>
					<Input
						type="password"
						value={localPassword}
						onChange={(e) => setLocalPassword(e.target.value)}
						autoComplete="current-password"
					/>
				</div>
				<p className="text-2xs text-fg-subtle">
					Stored encrypted, used only to connect to your mail server.{" "}
					{appPasswordUrl ? (
						<a
							href={appPasswordUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-accent underline"
						>
							How to create an app password
						</a>
					) : (
						<span>
							Check your provider's help for app password instructions.
						</span>
					)}
				</p>
			</div>
		</WizardShell>
	);
}

function StepTest({
	email,
	imapConfig,
	smtpConfig,
	username,
	password,
	onSuccess,
	onBackToCredentials,
	onBackToServers,
}: {
	email: string;
	imapConfig: ServerConfig;
	smtpConfig: ServerConfig;
	username: string;
	password: string;
	onSuccess: () => void;
	onBackToCredentials: () => void;
	onBackToServers: () => void;
}) {
	const [testResult, setTestResult] = useState<TestResult>({
		imapState: "running",
		smtpState: "pending",
		phase: "running",
	});
	const hasRunRef = useRef(false);
	const imapTls = securityToApi(imapConfig.security);
	const smtpTls = securityToApi(smtpConfig.security);

	const testMutation = useMutation({
		...accountOperationsTestConnectionMutation(),
	});

	useEffect(() => {
		if (hasRunRef.current) return;
		hasRunRef.current = true;

		setTestResult({
			imapState: "running",
			smtpState: "pending",
			phase: "running",
		});

		testMutation.mutate(
			{
				body: {
					username,
					password,
					imapHost: imapConfig.host,
					imapPort: imapConfig.port,
					imapTls: imapTls.tls,
					imapStartTls: imapTls.startTls,
					smtpHost: smtpConfig.host,
					smtpPort: smtpConfig.port,
					smtpTls: smtpTls.tls,
					smtpStartTls: smtpTls.startTls,
				},
			},
			{
				onSuccess: (data) => {
					// Show IMAP result first, then SMTP
					const imapOk = data.imapSuccess;
					const smtpOk = data.smtpSuccess;

					setTestResult({
						imapState: imapOk ? "ok" : "failed",
						smtpState: "running",
						imapDetail: imapOk
							? `Connected — ${imapConfig.host}:${imapConfig.port}`
							: data.imapError,
						phase: "running",
					});

					window.setTimeout(() => {
						// An auth error can come from either protocol; route on the
						// one that actually failed. IMAP failures take precedence in
						// the raw-error display since IMAP is tested first.
						const isAuthError = (msg: string | undefined): boolean => {
							const m = msg?.toLowerCase() ?? "";
							return (
								m.includes("auth") ||
								m.includes("login") ||
								m.includes("535") ||
								m.includes("credential")
							);
						};
						const isAuthFailure =
							(!imapOk && isAuthError(data.imapError)) ||
							(imapOk && !smtpOk && isAuthError(data.smtpError));

						setTestResult({
							imapState: imapOk ? "ok" : "failed",
							smtpState: smtpOk ? "ok" : "failed",
							imapDetail: imapOk
								? `Connected — ${imapConfig.host}:${imapConfig.port}`
								: data.imapError,
							smtpDetail: smtpOk
								? `Connected — ${smtpConfig.host}:${smtpConfig.port}`
								: data.smtpError,
							rawError: !imapOk ? data.imapError : data.smtpError,
							phase:
								imapOk && smtpOk
									? "success"
									: isAuthFailure
										? "auth-failure"
										: "network-failure",
						});

						if (imapOk && smtpOk) {
							window.setTimeout(onSuccess, 800);
						}
					}, 400);
				},
				onError: (err) => {
					const msg = err instanceof Error ? err.message : "Connection failed";
					setTestResult({
						imapState: "failed",
						smtpState: "failed",
						imapDetail: msg,
						smtpDetail: msg,
						rawError: msg,
						phase: "network-failure",
					});
				},
			},
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const { phase } = testResult;

	// Keyboard: Esc goes back based on failure type
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (phase === "auth-failure") onBackToCredentials();
				else if (phase === "network-failure") onBackToServers();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [phase, onBackToCredentials, onBackToServers]);

	const footer =
		phase === "auth-failure" ? (
			<>
				<Button variant="ghost" onClick={onBackToCredentials}>
					Back to credentials
				</Button>
				<Button
					variant="primary"
					onClick={() => {
						hasRunRef.current = false;
						setTestResult({
							imapState: "running",
							smtpState: "pending",
							phase: "running",
						});
					}}
				>
					Retry
				</Button>
			</>
		) : phase === "network-failure" ? (
			<>
				<Button variant="ghost" onClick={onBackToServers}>
					Back to servers
				</Button>
				<Button
					variant="primary"
					onClick={() => {
						hasRunRef.current = false;
						setTestResult({
							imapState: "running",
							smtpState: "pending",
							phase: "running",
						});
					}}
				>
					Retry
				</Button>
			</>
		) : phase === "success" ? (
			<>
				<span className="text-2xs text-fg-subtle">Connection verified</span>
				<Button variant="primary" onClick={onSuccess}>
					Start syncing
				</Button>
			</>
		) : (
			<>
				<span className="text-2xs text-fg-subtle">Testing…</span>
				<span />
			</>
		);

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.test}
			title="Testing the connection"
			subtitle={`Checking ${email}`}
			footer={footer}
		>
			<div className="divide-y divide-line">
				<CheckRow
					label={`IMAP — ${imapConfig.host}:${imapConfig.port}`}
					detail={testResult.imapDetail}
					state={testResult.imapState}
				/>
				<CheckRow
					label={`SMTP — ${smtpConfig.host}:${smtpConfig.port}`}
					detail={testResult.smtpDetail}
					state={testResult.smtpState}
				/>
				{(phase === "auth-failure" || phase === "network-failure") &&
					testResult.rawError && (
						<div className="py-3">
							{phase === "auth-failure" && (
								<p className="mb-2 text-xs text-fg-muted">
									Check your password — many providers require an app password.
								</p>
							)}
							<code className="block rounded bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
								{testResult.rawError}
							</code>
						</div>
					)}
			</div>
		</WizardShell>
	);
}

function StepSync({
	email,
	imapConfig,
	smtpConfig,
	username,
	password,
	onGoToInbox,
}: {
	email: string;
	imapConfig: ServerConfig;
	smtpConfig: ServerConfig;
	username: string;
	password: string;
	onGoToInbox: (accountId: string) => void;
}) {
	const queryClient = useQueryClient();
	const [accountId, setAccountId] = useState<string | null>(null);
	const [createError, setCreateError] = useState<string | null>(null);
	const hasCreatedRef = useRef(false);

	const imapTls = securityToApi(imapConfig.security);
	const smtpTls = securityToApi(smtpConfig.security);

	const createMutation = useMutation({
		...accountOperationsCreateAccountMutation(),
		onSuccess: (data) => {
			setAccountId(data.accountId);
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
		},
		onError: (err) => {
			setCreateError(
				err instanceof Error ? err.message : "Failed to create account",
			);
		},
	});

	// Create the account once on mount
	useEffect(() => {
		if (hasCreatedRef.current) return;
		hasCreatedRef.current = true;

		// Autofill SMTP from IMAP if needed
		const autoFill = computeSmtpAutoFill({
			imapHost: imapConfig.host,
			smtpHost: smtpConfig.host,
			smtpPort: smtpConfig.port,
			smtpTls: smtpTls.tls,
			smtpStartTls: smtpTls.startTls,
		});
		const effectiveSmtp = autoFill ?? {
			smtpHost: smtpConfig.host,
			smtpPort: smtpConfig.port,
			smtpTls: smtpTls.tls,
			smtpStartTls: smtpTls.startTls,
		};

		createMutation.mutate({
			body: {
				email,
				username: username !== email ? username : undefined,
				password,
				imapHost: imapConfig.host,
				imapPort: imapConfig.port,
				imapTls: imapTls.tls,
				imapStartTls: imapTls.startTls,
				smtpHost: effectiveSmtp.smtpHost || undefined,
				smtpPort: effectiveSmtp.smtpPort || undefined,
				smtpTls: effectiveSmtp.smtpTls,
				smtpStartTls: effectiveSmtp.smtpStartTls,
			},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Poll sync status every 2s once account is created. Stop polling once the
	// account reaches a terminal phase (complete/error) so we don't hammer the
	// endpoint while the user lingers on this step (pattern from ComposeProvider).
	const { data: syncStatus } = useQuery({
		...syncOperationsGetSyncStatusOptions({
			path: { accountId: accountId ?? "" },
		}),
		enabled: !!accountId,
		refetchInterval: (query) => {
			const phase = query.state.data?.syncPhase;
			return phase === "complete" || phase === "error" ? false : 2000;
		},
	});

	// When the account reaches a terminal error phase, surface its lastError
	// from the config (the sync-status response carries syncPhase but not
	// lastError). Only fetched once the account is created and in error.
	const syncErrored = syncStatus?.syncPhase === "error";
	const { data: config } = useQuery({
		...configOperationsGetConfigOptions(),
		enabled: !!accountId && syncErrored,
	});
	const syncLastError = config?.accounts.find(
		(a) => a.accountId === accountId,
	)?.lastError;

	// Determine inbox progress from mailboxes array
	const inboxMailbox = syncStatus?.mailboxes.find(
		(m) => m.fullPath === "INBOX" || m.fullPath === "Inbox",
	);
	const totalMailboxes = syncStatus?.mailboxCountTotal ?? 0;
	const syncedMailboxes = syncStatus?.mailboxCountSynced ?? 0;
	const inboxTotal = inboxMailbox?.messagesTotal ?? 0;
	const inboxSynced = inboxMailbox?.messagesSynced ?? 0;
	const inboxProgress = inboxTotal > 0 ? inboxSynced / inboxTotal : 0;
	const hasInboxMessages = inboxSynced > 0;

	// Determine check states based on syncPhase
	const syncPhase = syncStatus?.syncPhase;
	const mailboxState = syncErrored
		? "failed"
		: syncPhase === "idle" || syncPhase === undefined
			? "running"
			: syncPhase === "discovering_mailboxes"
				? "running"
				: totalMailboxes > 0
					? "ok"
					: "running";

	const inboxSyncState = syncErrored
		? "failed"
		: !syncPhase ||
				syncPhase === "idle" ||
				syncPhase === "discovering_mailboxes"
			? "pending"
			: syncPhase === "syncing_inbox" || syncPhase === "syncing_others"
				? "running"
				: "ok";

	const otherSyncState = syncErrored
		? "failed"
		: !syncPhase ||
				syncPhase === "idle" ||
				syncPhase === "discovering_mailboxes" ||
				syncPhase === "syncing_inbox"
			? "pending"
			: syncPhase === "syncing_others"
				? "running"
				: "ok";

	if (createError) {
		return (
			<WizardShell
				steps={STEP_LABELS}
				activeStep={STEP_INDEX.sync}
				title="Couldn't create account"
				subtitle="Something went wrong saving your account."
				footer={
					<>
						<span />
						<Button
							variant="primary"
							onClick={() => {
								hasCreatedRef.current = false;
								setCreateError(null);
								createMutation.mutate({
									body: {
										email,
										username: username !== email ? username : undefined,
										password,
										imapHost: imapConfig.host,
										imapPort: imapConfig.port,
										imapTls: imapTls.tls,
										imapStartTls: imapTls.startTls,
										smtpHost: smtpConfig.host || undefined,
										smtpPort: smtpConfig.port || undefined,
										smtpTls: smtpTls.tls,
										smtpStartTls: smtpTls.startTls,
									},
								});
							}}
						>
							Retry
						</Button>
					</>
				}
			>
				<code className="block rounded bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
					{createError}
				</code>
			</WizardShell>
		);
	}

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.sync}
			title={`Syncing ${email}`}
			subtitle="Newest mail first — you can start reading right away."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						Sync continues in the background
					</span>
					<Button
						variant="primary"
						disabled={!hasInboxMessages || !accountId}
						onClick={() => accountId && onGoToInbox(accountId)}
					>
						Go to inbox
					</Button>
				</>
			}
		>
			{createMutation.isPending ? (
				<div className="flex items-center gap-2 py-4 text-sm text-fg-muted">
					<Loader2 className="size-4 animate-spin text-accent" />
					Creating your account…
				</div>
			) : (
				<div className="space-y-3">
					{inboxTotal > 0 && (
						<div>
							<div className="flex items-baseline justify-between text-xs">
								<span className="font-medium text-fg">INBOX</span>
								<span className="text-fg-subtle tabular-nums">
									{inboxSynced.toLocaleString()} / {inboxTotal.toLocaleString()}{" "}
									messages
								</span>
							</div>
							<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
								<div
									className="h-full rounded-full bg-accent transition-all duration-500"
									style={{ width: `${Math.max(2, inboxProgress * 100)}%` }}
								/>
							</div>
						</div>
					)}
					<div className="divide-y divide-line">
						<CheckRow
							label="Mailboxes discovered"
							detail={
								totalMailboxes > 0
									? `${totalMailboxes} mailbox${totalMailboxes === 1 ? "" : "es"} found`
									: "Discovering…"
							}
							state={mailboxState}
						/>
						<CheckRow
							label="INBOX"
							detail={
								inboxSyncState === "ok"
									? `${inboxSynced.toLocaleString()} messages synced`
									: inboxSyncState === "running"
										? "Syncing newest first…"
										: "Queued"
							}
							state={inboxSyncState}
						/>
						{syncedMailboxes > 1 ||
						syncPhase === "syncing_others" ||
						syncPhase === "complete" ? (
							<CheckRow
								label="Other mailboxes"
								detail={
									otherSyncState === "ok"
										? `${syncedMailboxes - 1} mailboxes synced`
										: otherSyncState === "running"
											? "Syncing…"
											: "Queued"
								}
								state={otherSyncState}
							/>
						) : null}
					</div>
					{syncErrored && (
						<div className="mt-2 space-y-2">
							<p className="text-xs text-danger">
								Sync stalled. The account is still active —{" "}
								<button
									type="button"
									className="underline"
									onClick={() => {
										queryClient.invalidateQueries({
											queryKey: syncOperationsGetSyncStatusOptions({
												path: { accountId: accountId ?? "" },
											}).queryKey,
										});
									}}
								>
									retry
								</button>
							</p>
							{syncLastError && (
								<code className="block rounded bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
									{syncLastError}
								</code>
							)}
						</div>
					)}
				</div>
			)}
		</WizardShell>
	);
}

/* ------------------------------------------------------------------ */
/* Main wizard orchestrator                                           */
/* ------------------------------------------------------------------ */

export interface OnboardingWizardProps {
	/** If false, show the Welcome step first */
	skipWelcome?: boolean;
	/** Called when the user clicks "Go to inbox" with the new accountId */
	onComplete: (accountId: string) => void;
	/** Called when the user cancels (Esc from connector picker) */
	onCancel?: () => void;
}

export function OnboardingWizard({
	skipWelcome = false,
	onComplete,
	onCancel,
}: OnboardingWizardProps) {
	const [step, setStep] = useState<WizardStep>(
		skipWelcome ? "connector" : "welcome",
	);
	const [state, setState] = useState<WizardState>({
		email: "",
		imapConfig: DEFAULT_IMAP,
		smtpConfig: DEFAULT_SMTP,
		username: "",
		password: "",
		discoveryResult: null,
		discovered: false,
		createdAccountId: null,
	});

	// Welcome → Connector
	const handleWelcomeStart = useCallback(() => setStep("connector"), []);

	// Connector → Address (or cancel)
	const handleConnectorContinue = useCallback(() => setStep("address"), []);
	const handleConnectorBack = useCallback(() => {
		if (skipWelcome) {
			onCancel?.();
		} else {
			setStep("welcome");
		}
	}, [skipWelcome, onCancel]);

	// Address → Servers
	const handleAddressContinue = useCallback(
		(email: string, result: DiscoveryResult | null) => {
			let imap = DEFAULT_IMAP;
			let smtp = DEFAULT_SMTP;
			let discovered = false;

			if (result) {
				// Heuristic is a fallback, not "discovered"
				discovered = result.source !== "heuristic";
				imap = {
					host: result.imap.host,
					port: result.imap.port,
					security: result.imap.security,
				};
				smtp = {
					host: result.smtp.host,
					port: result.smtp.port,
					security: result.smtp.security,
				};
			}

			setState((s) => ({
				...s,
				email,
				imapConfig: imap,
				smtpConfig: smtp,
				discoveryResult: result,
				discovered,
				username: email,
			}));
			setStep("servers");
		},
		[],
	);

	// Servers → Credentials
	const handleServersChange = useCallback(
		(imap: ServerConfig, smtp: ServerConfig) => {
			setState((s) => ({ ...s, imapConfig: imap, smtpConfig: smtp }));
		},
		[],
	);

	// Credentials → Test
	const handleCredentialsChange = useCallback(
		(username: string, password: string) => {
			setState((s) => ({ ...s, username, password }));
		},
		[],
	);

	// Test → Sync
	const handleTestSuccess = useCallback(() => setStep("sync"), []);

	// Sync → Inbox
	const handleGoToInbox = useCallback(
		(accountId: string) => {
			onComplete(accountId);
		},
		[onComplete],
	);

	switch (step) {
		case "welcome":
			return <StepWelcome onStart={handleWelcomeStart} />;

		case "connector":
			return (
				<StepConnector
					onContinue={handleConnectorContinue}
					onBack={handleConnectorBack}
					showBack={!skipWelcome}
				/>
			);

		case "address":
			return (
				<StepAddress
					initialEmail={state.email}
					onContinue={handleAddressContinue}
					onBack={() => setStep("connector")}
				/>
			);

		case "servers":
			return (
				<StepServers
					email={state.email}
					imapConfig={state.imapConfig}
					smtpConfig={state.smtpConfig}
					discovered={state.discovered}
					onContinue={() => setStep("credentials")}
					onBack={() => setStep("address")}
					onChange={handleServersChange}
				/>
			);

		case "credentials":
			return (
				<StepCredentials
					email={state.email}
					username={state.username}
					password={state.password}
					onContinue={() => setStep("test")}
					onBack={() => setStep("servers")}
					onChange={handleCredentialsChange}
				/>
			);

		case "test":
			return (
				<StepTest
					email={state.email}
					imapConfig={state.imapConfig}
					smtpConfig={state.smtpConfig}
					username={state.username}
					password={state.password}
					onSuccess={handleTestSuccess}
					onBackToCredentials={() => setStep("credentials")}
					onBackToServers={() => setStep("servers")}
				/>
			);

		case "sync":
			return (
				<StepSync
					email={state.email}
					imapConfig={state.imapConfig}
					smtpConfig={state.smtpConfig}
					username={state.username}
					password={state.password}
					onGoToInbox={handleGoToInbox}
				/>
			);
	}
}
