/**
 * OnboardingWizard — full 7-step onboarding flow.
 *
 * Steps: Welcome → Connector → Address → Servers → Credentials → Test → Sync
 *        Microsoft path: Connector → MicrosoftEmail → redirect
 *
 * Entry points:
 *  - First-run (zero accounts): full-screen wizard via /onboarding route
 *  - Settings "Add account": steps 2-7 embedded in the settings content area
 *
 * Backend deps status:
 *  - POST /accounts — CREATE. Exists.
 *  - POST /accounts/test-connection — Exists.
 *  - GET /accounts/{accountId}/sync/status — Exists (#431 syncPhase).
 *  - POST /accounts/oauth/microsoft/start — Exists (#473).
 *  - GET /autodiscovery?email=… — NOT YET IMPLEMENTED (TypeSpec-first, future).
 *    Client-side autodiscovery (provider table + Mozilla autoconfig) used instead.
 */

import {
	accountOperationsCreateAccountMutation,
	accountOperationsTestConnectionMutation,
	configOperationsGetConfigOptions,
	configOperationsGetConfigQueryKey,
	microsoftOAuthOperationsMicrosoftOAuthStartMutation,
	syncOperationsGetSyncStatusOptions,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	AppPasswordHint,
	Banner,
	Button,
	CheckRow,
	ConnectorTile,
	FieldLabel,
	Input,
	Kbd,
	PasswordInput,
	Select,
	ServerFields,
	securityToApi,
	WizardShell,
} from "@remit/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Inbox, Loader2, Mail, Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReturnFromRedirect } from "../../hooks/useReturnFromRedirect.js";
// useRef is kept for the hasCreatedRef guard — not for DOM refs
import {
	type DiscoveryResult,
	discoverSettings,
	getAppPasswordUrl,
	getDiscoveryStatusMessage,
	type SecurityMode,
} from "../../lib/autodiscovery.js";
import {
	getPresetById,
	PROVIDER_PRESETS,
	presetIdForEmail,
} from "../../lib/provider-presets.js";
import { computeSmtpAutoFill } from "../settings/account-form-helpers.js";

/* ------------------------------------------------------------------ */
/* Wizard step definitions                                            */
/* ------------------------------------------------------------------ */

type WizardStep =
	| "welcome"
	| "connector"
	| "microsoft-email"
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
	"microsoft-email": 0,
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
	displayName: string;
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

type ConnectorChoice = "imap" | "microsoft";

function StepConnector({
	onContinue,
	onMicrosoft,
	onBack,
	showBack,
}: {
	onContinue: () => void;
	onMicrosoft: () => void;
	onBack: () => void;
	showBack: boolean;
}) {
	const [selected, setSelected] = useState<ConnectorChoice>("imap");

	// Keyboard: Enter advances, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				if (selected === "microsoft") onMicrosoft();
				else onContinue();
			}
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onContinue, onMicrosoft, onBack, selected]);

	const handleContinue = () => {
		if (selected === "microsoft") onMicrosoft();
		else onContinue();
	};

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.connector}
			title="How does this account connect?"
			subtitle="Choose a sign-in method. IMAP works with any provider."
			footer={
				<>
					{showBack ? (
						<Button variant="ghost" onClick={onBack}>
							Back
						</Button>
					) : (
						<span />
					)}
					<Button variant="primary" onClick={handleContinue}>
						{selected === "microsoft"
							? "Continue with Microsoft"
							: "Continue with IMAP"}
					</Button>
				</>
			}
		>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<ConnectorTile
					name="IMAP / SMTP"
					description="Any mail provider — Fastmail, iCloud, your own server."
					icon={<Server className="size-5" />}
					selected={selected === "imap"}
					onSelect={() => setSelected("imap")}
				/>
				<ConnectorTile
					name="Gmail"
					description="Sign in with Google. No app passwords."
					icon={<AtSign className="size-5" />}
					comingSoon
				/>
				<ConnectorTile
					name="Outlook / Microsoft 365"
					description="Sign in with Microsoft. Works with Outlook.com and work accounts."
					icon={<Inbox className="size-5" />}
					selected={selected === "microsoft"}
					onSelect={() => setSelected("microsoft")}
				/>
			</div>
		</WizardShell>
	);
}

function StepMicrosoftEmail({
	onBack,
	onConnected,
}: {
	onBack: () => void;
	onConnected: (accountId: string) => void;
}) {
	const [email, setEmail] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [awaitingReturn, setAwaitingReturn] = useState(false);
	const [preparing, setPreparing] = useState(false);
	// `visibilitychange` fires for every look at this window, including one
	// taken while the redirect is still fetching Microsoft's page — app-switch
	// away and back lands here with the page never having left. Being looked at
	// only proves the redirect ended once the page has actually been hidden,
	// so a look counts as evidence only after a hidden interval since it began.
	const hiddenSinceRedirect = useRef(false);
	// The account read is in flight across a step the user can leave — Escape and
	// Back both unmount it — and it ends in a redirect that would take the whole
	// window with it.
	const stepIsMounted = useRef(true);
	useEffect(() => {
		stepIsMounted.current = true;
		return () => {
			stepIsMounted.current = false;
		};
	}, []);
	// The accounts this instance held when the redirect started. What comes back
	// is recognised as new against it, so it has to be a real list — against an
	// empty stand-in every account already here reads as the one just connected.
	const accountIdsBeforeRedirect = useRef<ReadonlySet<string>>(new Set());

	const { refetch: refetchConfig } = useQuery(
		configOperationsGetConfigOptions(),
	);

	const startMutation = useMutation({
		...microsoftOAuthOperationsMicrosoftOAuthStartMutation(),
		onSuccess: (data) => {
			// A step the user left while this was in flight does not get to take the
			// window with it. `assign` is not synchronous either — the page is still
			// here while the browser fetches Microsoft's — so the control stays busy
			// until the window is actually looked at again.
			if (!stepIsMounted.current) return;
			setAwaitingReturn(true);
			window.location.assign(data.authorizationUrl);
		},
		onError: (err) => {
			setPreparing(false);
			setError(err instanceof Error ? err.message : "Failed to start sign-in");
		},
	});

	// Microsoft's answer comes back to whichever window the platform picks, and
	// on iOS that is often the browser rather than the app launched from the
	// home screen. So this window decides on the account list rather than on
	// having been the one that got the redirect: an account that was not there
	// before carries the wizard forward.
	//
	// Every look at this window is a chance to find that account, not a verdict
	// on the sign-in — a user who switches back mid-flow to read a password has
	// not failed anything, so nothing here concludes and the check stays armed
	// until an account appears or the user leaves the step.
	useReturnFromRedirect(
		awaitingReturn,
		useCallback(() => {
			if (!hiddenSinceRedirect.current) return;
			// The window that was leaving is back, so the button is too.
			hiddenSinceRedirect.current = false;
			setPreparing(false);
			void refetchConfig().then(({ data, isError }) => {
				if (!stepIsMounted.current) return;
				if (isError || !data) {
					setError(
						"Couldn't check whether the sign-in finished. Open Settings › Accounts to see whether the account is connected.",
					);
					return;
				}
				setError(null);
				const connected = data.accounts.find(
					(account) => !accountIdsBeforeRedirect.current.has(account.accountId),
				);
				if (connected) onConnected(connected.accountId);
			});
		}, [refetchConfig, onConnected]),
	);

	useEffect(() => {
		if (!awaitingReturn) return;
		const handle = () => {
			if (document.visibilityState === "hidden") {
				hiddenSinceRedirect.current = true;
			}
		};
		document.addEventListener("visibilitychange", handle);
		window.addEventListener("pagehide", handle);
		return () => {
			document.removeEventListener("visibilitychange", handle);
			window.removeEventListener("pagehide", handle);
		};
	}, [awaitingReturn]);

	// The account list is read first and the redirect goes from what it says, so
	// the window that comes back has something to recognise a new account
	// against. A list that cannot be read stops the flow here, where it can be
	// retried, rather than at the return leg where nothing can be concluded.
	const redirecting = preparing || startMutation.isPending;

	const handleSubmit = () => {
		if (redirecting) return;
		setError(null);
		hiddenSinceRedirect.current = false;
		setPreparing(true);
		void refetchConfig().then(({ data, isError }) => {
			if (!stepIsMounted.current) return;
			if (isError || !data) {
				setPreparing(false);
				setError(
					"Couldn't read this instance's accounts, so sign-in can't be tracked. Check your connection and try again.",
				);
				return;
			}
			accountIdsBeforeRedirect.current = new Set(
				data.accounts.map((account) => account.accountId),
			);
			startMutation.mutate({
				body: { email: email.trim() || undefined },
			});
		});
	};

	// Keyboard: Enter submits, Esc goes back. The listener reads the submit
	// through a ref rather than closing over it, so Enter sends the address the
	// field holds now instead of whatever it held when the listener went on.
	const submitRef = useRef(handleSubmit);
	submitRef.current = handleSubmit;
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter") submitRef.current();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onBack]);

	return (
		<WizardShell
			steps={STEP_LABELS}
			activeStep={STEP_INDEX.connector}
			title="Sign in with Microsoft"
			subtitle="You'll be redirected to Microsoft to sign in securely."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button
						variant="primary"
						onClick={handleSubmit}
						disabled={redirecting}
						icon={
							redirecting ? (
								<Loader2 className="size-4 animate-spin" />
							) : undefined
						}
					>
						{redirecting
							? "Redirecting…"
							: awaitingReturn
								? "Start over"
								: "Sign in with Microsoft"}
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				<div>
					<FieldLabel htmlFor="microsoft-email">
						Email address (optional)
					</FieldLabel>
					<Input
						id="microsoft-email"
						icon={<AtSign className="size-4" />}
						placeholder="you@outlook.com"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						type="email"
						autoComplete="email"
					/>
					<p className="mt-1.5 text-2xs text-fg-subtle">
						Pre-fills the Microsoft sign-in form. Leave blank to choose on the
						Microsoft page.
					</p>
				</div>
				{awaitingReturn && (
					<Banner tone="info">
						Waiting for Microsoft. Finish signing in — this window carries on
						the moment the account is connected, wherever you finished.
					</Banner>
				)}
				{error && <Banner tone="danger">{error}</Banner>}
			</div>
		</WizardShell>
	);
}

function StepAddress({
	initialEmail,
	initialDisplayName,
	onContinue,
	onBack,
}: {
	initialEmail: string;
	initialDisplayName: string;
	onContinue: (
		email: string,
		displayName: string,
		result: DiscoveryResult | null,
	) => void;
	onBack: () => void;
}) {
	const [email, setEmail] = useState(initialEmail);
	const [displayName, setDisplayName] = useState(initialDisplayName);
	const [discovering, setDiscovering] = useState(false);
	const [statusMsg, setStatusMsg] = useState("");
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = useCallback(async () => {
		const trimmed = email.trim();
		if (!trimmed.includes("@") || !trimmed.includes(".")) {
			setError("Enter a valid email address.");
			return;
		}
		setError(null);

		setDiscovering(true);
		setStatusMsg(getDiscoveryStatusMessage(trimmed));
		try {
			// Short budget — browser autoconfig fetches are CORS-blocked and
			// fall through to the heuristic; see discoverSettings docs.
			const result = await discoverSettings(trimmed);
			onContinue(trimmed, displayName.trim(), result);
		} finally {
			setDiscovering(false);
		}
	}, [email, displayName, onContinue]);

	// Keyboard: Enter submits, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter" && !discovering) void handleSubmit();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [handleSubmit, discovering, onBack]);

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
						disabled={discovering}
						onClick={() => void handleSubmit()}
					>
						Continue
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div>
					<FieldLabel htmlFor="onboarding-email">Email address</FieldLabel>
					<Input
						id="onboarding-email"
						icon={<AtSign className="size-4" />}
						placeholder="you@example.com"
						value={email}
						onChange={(e) => {
							setEmail(e.target.value);
							setError(null);
						}}
						type="email"
						autoComplete="email"
					/>
				</div>
				<div>
					<FieldLabel htmlFor="onboarding-display-name">
						Display name (optional)
					</FieldLabel>
					<Input
						id="onboarding-display-name"
						placeholder="Alice"
						value={displayName}
						onChange={(e) => setDisplayName(e.target.value)}
					/>
					<p className="mt-1.5 text-2xs text-fg-subtle">
						What to call this account in Remit. Leave blank to use a name
						derived from the address.
					</p>
				</div>
				{discovering && (
					<div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
						<Loader2 className="size-3.5 animate-spin text-accent" />
						{statusMsg}
					</div>
				)}
				{error && !discovering && (
					<div className="mt-3">
						<Banner tone="danger">{error}</Banner>
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
	const [providerId, setProviderId] = useState<string>(() =>
		presetIdForEmail(email),
	);
	const [advanced, setAdvanced] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const preset = getPresetById(providerId);
	// A recognised provider locks the fields until the user chooses Advanced.
	const locked = preset !== undefined && !advanced;

	const applyPreset = useCallback((id: string) => {
		setProviderId(id);
		setAdvanced(false);
		setError(null);
		const next = getPresetById(id);
		if (!next) return;
		setImap({
			host: next.imap.host,
			port: next.imap.port,
			security: next.imap.security,
		});
		setSmtp({
			host: next.smtp.host,
			port: next.smtp.port,
			security: next.smtp.security,
		});
	}, []);

	// Propagate changes upward immediately
	useEffect(() => {
		onChange(imap, smtp);
	}, [imap, smtp, onChange]);

	const isValid = imap.host.trim() !== "";

	const handleContinue = useCallback(() => {
		if (!isValid) {
			setError("Enter the IMAP host.");
			return;
		}
		setError(null);
		onContinue();
	}, [isValid, onContinue]);

	// Keyboard: Enter advances, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter") handleContinue();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [handleContinue, onBack]);

	const domain = email.split("@")[1] ?? "your domain";
	const subtitle = preset
		? "Pick your provider to fill in the right settings — or choose Custom to enter them by hand."
		: discovered
			? "Found via autodiscovery — adjust anything that looks off."
			: `We couldn't detect settings for ${domain} — enter them manually.`;

	const badge = locked
		? ({ label: "preset", tone: "neutral" } as const)
		: !preset && discovered
			? ({ label: "detected", tone: "positive" } as const)
			: undefined;

	const appPasswordUrl = preset?.passwordHelp.url ?? getAppPasswordUrl(email);

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
					<Button variant="primary" onClick={handleContinue}>
						Continue
					</Button>
				</>
			}
		>
			<div className="space-y-5">
				{error && <Banner tone="danger">{error}</Banner>}
				<div>
					<FieldLabel htmlFor="provider-select">Provider</FieldLabel>
					<Select
						id="provider-select"
						value={providerId}
						onChange={(e) => applyPreset(e.target.value)}
					>
						<option value="">Custom / other</option>
						{PROVIDER_PRESETS.map((p) => (
							<option key={p.id} value={p.id}>
								{p.label}
							</option>
						))}
					</Select>
					{preset && (
						<p className="mt-1 text-2xs text-fg-subtle">
							{locked ? (
								<>
									Server settings are pre-filled for {preset.label} and locked.{" "}
									<button
										type="button"
										className="text-accent underline"
										onClick={() => setAdvanced(true)}
									>
										Advanced
									</button>{" "}
									lets you edit them by hand.
								</>
							) : (
								<>Editing {preset.label}'s settings by hand.</>
							)}
						</p>
					)}
				</div>
				<ServerFields
					legend="IMAP — incoming"
					badge={badge}
					readOnly={locked}
					host={imap.host}
					port={String(imap.port)}
					security={imap.security}
					hostPlaceholder="imap.example.com"
					portPlaceholder="993"
					onHostChange={(v) => {
						setImap((s) => ({ ...s, host: v }));
						setError(null);
					}}
					onPortChange={(v) => setImap((s) => ({ ...s, port: Number(v) }))}
					onSecurityChange={(v) => setImap((s) => ({ ...s, security: v }))}
				/>
				<p className="text-2xs text-fg-subtle">
					Sending (SMTP) is optional — leave it blank to set up a receive-only
					account and add sending later in Settings.
				</p>
				<ServerFields
					legend="SMTP — outgoing (optional)"
					badge={badge}
					readOnly={locked}
					host={smtp.host}
					port={String(smtp.port)}
					security={smtp.security}
					hostPlaceholder="smtp.example.com"
					portPlaceholder="587"
					onHostChange={(v) => {
						setSmtp((s) => ({ ...s, host: v }));
						setError(null);
					}}
					onPortChange={(v) => setSmtp((s) => ({ ...s, port: Number(v) }))}
					onSecurityChange={(v) => setSmtp((s) => ({ ...s, security: v }))}
				/>
				{preset && (
					<p className="text-2xs text-fg-subtle">
						{preset.passwordHelp.text}{" "}
						{appPasswordUrl && (
							<a
								href={appPasswordUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-accent underline"
							>
								Get an app password
							</a>
						)}
					</p>
				)}
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
	const [error, setError] = useState<string | null>(null);

	const domain = email.split("@")[1] ?? "";
	const appPasswordUrl = getAppPasswordUrl(email);
	const isValid = localUsername.trim() !== "" && localPassword.trim() !== "";

	useEffect(() => {
		onChange(localUsername, localPassword);
	}, [localUsername, localPassword, onChange]);

	const handleContinue = useCallback(() => {
		if (!isValid) {
			setError("Enter your username and password.");
			return;
		}
		setError(null);
		onContinue();
	}, [isValid, onContinue]);

	// Keyboard: Enter advances, Esc goes back
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Enter") handleContinue();
			if (e.key === "Escape") onBack();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [handleContinue, onBack]);

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
					<Button variant="primary" onClick={handleContinue}>
						Test connection
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				{error && (
					<div className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
						{error}
					</div>
				)}
				<div>
					<FieldLabel htmlFor="credentials-username">Username</FieldLabel>
					<Input
						id="credentials-username"
						value={localUsername}
						onChange={(e) => {
							setLocalUsername(e.target.value);
							setError(null);
						}}
						autoComplete="username"
					/>
				</div>
				<div>
					<FieldLabel htmlFor="credentials-password">
						Password or app password
					</FieldLabel>
					<PasswordInput
						id="credentials-password"
						value={localPassword}
						onChange={(e) => {
							setLocalPassword(e.target.value);
							setError(null);
						}}
						autoComplete="current-password"
					/>
				</div>
				<AppPasswordHint url={appPasswordUrl} />
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
	const [attempt, setAttempt] = useState(0);
	const smtpConfigured = smtpConfig.host.trim() !== "";
	const imapTls = securityToApi(imapConfig.security);
	const smtpTls = securityToApi(smtpConfig.security);

	const testMutation = useMutation({
		...accountOperationsTestConnectionMutation(),
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on mount and each Retry via `attempt`; the connection inputs are read intentionally and must not re-trigger the test on every render
	useEffect(() => {
		let cancelled = false;
		const timers: number[] = [];

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
					if (cancelled) return;
					// Show IMAP result first, then SMTP. SMTP is optional: when no
					// host was given the account is receive-only, so IMAP alone
					// decides success.
					const imapOk = data.imapSuccess;
					const smtpOk = smtpConfigured ? data.smtpSuccess : true;

					setTestResult({
						imapState: imapOk ? "ok" : "failed",
						smtpState: smtpConfigured ? "running" : "ok",
						imapDetail: imapOk
							? `Connected — ${imapConfig.host}:${imapConfig.port}`
							: data.imapError,
						phase: "running",
					});

					timers.push(
						window.setTimeout(() => {
							if (cancelled) return;
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
								(imapOk &&
									smtpConfigured &&
									!data.smtpSuccess &&
									isAuthError(data.smtpError));

							setTestResult({
								imapState: imapOk ? "ok" : "failed",
								smtpState: !smtpConfigured
									? "ok"
									: data.smtpSuccess
										? "ok"
										: "failed",
								imapDetail: imapOk
									? `Connected — ${imapConfig.host}:${imapConfig.port}`
									: data.imapError,
								smtpDetail: !smtpConfigured
									? "Not set up — receive-only"
									: data.smtpSuccess
										? `Connected — ${smtpConfig.host}:${smtpConfig.port}`
										: data.smtpError,
								rawError: !imapOk
									? data.imapError
									: smtpConfigured && !data.smtpSuccess
										? data.smtpError
										: undefined,
								phase:
									imapOk && smtpOk
										? "success"
										: isAuthFailure
											? "auth-failure"
											: "network-failure",
							});

							if (imapOk && smtpOk) {
								timers.push(
									window.setTimeout(() => {
										if (!cancelled) onSuccess();
									}, 800),
								);
							}
						}, 400),
					);
				},
				onError: (err) => {
					if (cancelled) return;
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

		return () => {
			cancelled = true;
			for (const t of timers) window.clearTimeout(t);
		};
	}, [attempt]);

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
				<Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>
					Retry
				</Button>
			</>
		) : phase === "network-failure" ? (
			<>
				<Button variant="ghost" onClick={onBackToServers}>
					Back to servers
				</Button>
				<Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>
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
					label={
						smtpConfigured
							? `SMTP — ${smtpConfig.host}:${smtpConfig.port}`
							: "SMTP — sending"
					}
					detail={
						smtpConfigured
							? testResult.smtpDetail
							: "Not set up — you can add sending later in Settings"
					}
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

/**
 * How long the sync step holds "Go to inbox" shut while it waits for the first
 * messages. Long enough for a normal IMAP handshake and first batch, short
 * enough that a stalled or silent sync never becomes a dead end.
 */
const INBOX_GATE_MAX_WAIT_MS = 20_000;

function StepSync({
	email,
	displayName,
	imapConfig,
	smtpConfig,
	username,
	password,
	onGoToInbox,
}: {
	email: string;
	displayName: string;
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect guarded by hasCreatedRef; re-running on field change would trigger duplicate account creation
	useEffect(() => {
		if (hasCreatedRef.current) return;
		hasCreatedRef.current = true;

		// SMTP is optional. When the user left the host blank the account is
		// receive-only: send no SMTP host so the backend derives smtpEnabled=false.
		// Only when a host was supplied do we autofill the remaining SMTP fields.
		const smtpConfigured = smtpConfig.host.trim() !== "";
		const autoFill = computeSmtpAutoFill({
			imapHost: imapConfig.host,
			smtpHost: smtpConfig.host,
			smtpPort: smtpConfig.port,
			smtpTls: smtpTls.tls,
			smtpStartTls: smtpTls.startTls,
		});
		const effectiveSmtp = smtpConfigured
			? (autoFill ?? {
					smtpHost: smtpConfig.host,
					smtpPort: smtpConfig.port,
					smtpTls: smtpTls.tls,
					smtpStartTls: smtpTls.startTls,
				})
			: null;

		createMutation.mutate({
			body: {
				email,
				displayName: displayName || undefined,
				username: username !== email ? username : undefined,
				password,
				imapHost: imapConfig.host,
				imapPort: imapConfig.port,
				imapTls: imapTls.tls,
				imapStartTls: imapTls.startTls,
				smtpHost: effectiveSmtp?.smtpHost || undefined,
				smtpPort: effectiveSmtp?.smtpPort || undefined,
				smtpTls: effectiveSmtp?.smtpTls ?? false,
				smtpStartTls: effectiveSmtp?.smtpStartTls ?? false,
			},
		});
	}, []);

	// Poll sync status every 2s once account is created. Stop polling once the
	// account reaches a terminal phase (complete/error) so we don't hammer the
	// endpoint while the user lingers on this step (pattern from ComposeProvider).
	const { data: syncStatus, isError: syncStatusUnavailable } = useQuery({
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

	// The inbox has something to show once the first messages have landed, the
	// INBOX mailbox is drained, or the account's sync reached a terminal phase.
	// Until then "Go to inbox" leads to an empty list, so it does not offer (#452).
	const inboxHasArrived =
		inboxSynced > 0 ||
		inboxMailbox?.phase === "complete" ||
		syncPhase === "complete" ||
		syncErrored;

	// Nothing above is allowed to strand the user: if the first messages have not
	// landed within the wait, or the status endpoint cannot answer at all, the
	// button opens regardless. The brief tells the truth about an empty list on
	// the other side, so an early exit costs a wait, not a lie.
	const [waitedLongEnough, setWaitedLongEnough] = useState(false);
	useEffect(() => {
		if (!accountId) return;
		const timer = setTimeout(
			() => setWaitedLongEnough(true),
			INBOX_GATE_MAX_WAIT_MS,
		);
		return () => clearTimeout(timer);
	}, [accountId]);

	const canGoToInbox =
		!!accountId &&
		(inboxHasArrived || syncStatusUnavailable || waitedLongEnough);

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
										displayName: displayName || undefined,
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
					{canGoToInbox ? (
						<Button
							variant="primary"
							onClick={() => accountId && onGoToInbox(accountId)}
						>
							Go to inbox
						</Button>
					) : (
						<Button
							variant="primary"
							disabled
							icon={<Loader2 className="size-3.5 animate-spin" />}
						>
							Getting your mail…
						</Button>
					)}
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
		displayName: "",
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

	// Connector → Address (IMAP path) or microsoft-email (Microsoft path), or cancel
	const handleConnectorContinue = useCallback(() => setStep("address"), []);
	const handleConnectorMicrosoft = useCallback(
		() => setStep("microsoft-email"),
		[],
	);
	const handleConnectorBack = useCallback(() => {
		if (skipWelcome) {
			onCancel?.();
		} else {
			setStep("welcome");
		}
	}, [skipWelcome, onCancel]);

	// Address → Servers
	const handleAddressContinue = useCallback(
		(email: string, displayName: string, result: DiscoveryResult | null) => {
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
				displayName,
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
					onMicrosoft={handleConnectorMicrosoft}
					onBack={handleConnectorBack}
					showBack={!skipWelcome}
				/>
			);

		case "microsoft-email":
			return (
				<StepMicrosoftEmail
					onBack={() => setStep("connector")}
					onConnected={handleGoToInbox}
				/>
			);

		case "address":
			return (
				<StepAddress
					initialEmail={state.email}
					initialDisplayName={state.displayName}
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
					displayName={state.displayName}
					imapConfig={state.imapConfig}
					smtpConfig={state.smtpConfig}
					username={state.username}
					password={state.password}
					onGoToInbox={handleGoToInbox}
				/>
			);
	}
}
