/**
 * The two steps that turn a mailbox address into a working connection: enter a
 * credential, then prove it against the server.
 *
 * They are shared rather than copied because two flows reach them. Onboarding
 * arrives with server settings the user just confirmed; a config import arrives
 * with server settings the file carried and a credential it deliberately did
 * not, and both then need the same answer from the same test endpoint. The rail
 * labels differ between the two, so they are props.
 */

import { accountOperationsTestConnectionMutation } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	AppPasswordHint,
	Banner,
	Button,
	CheckRow,
	FieldLabel,
	Input,
	PasswordInput,
	securityToApi,
	WizardShell,
} from "@remit/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
	getAppPasswordUrl,
	type SecurityMode,
} from "../../lib/autodiscovery.js";

export interface ServerConfig {
	host: string;
	port: number;
	security: SecurityMode;
}

export type TestPhase =
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

export interface CredentialsStepProps {
	steps: string[];
	activeStep: number;
	title: string;
	subtitle: string;
	email: string;
	username: string;
	password: string;
	/** Shown above the fields — the import flow says where the servers came from. */
	notice?: React.ReactNode;
	/** A refusal from the last attempt, in the server's own words. */
	error?: string;
	continueLabel?: string;
	backLabel?: string;
	onContinue: () => void;
	onBack: () => void;
	onChange: (username: string, password: string) => void;
}

export function CredentialsStep({
	steps,
	activeStep,
	title,
	subtitle,
	email,
	username,
	password,
	notice,
	error,
	continueLabel = "Test connection",
	backLabel = "Back",
	onContinue,
	onBack,
	onChange,
}: CredentialsStepProps) {
	const [localUsername, setLocalUsername] = useState(username || email);
	const [localPassword, setLocalPassword] = useState(password);
	const [validationError, setValidationError] = useState<string | null>(null);

	const appPasswordUrl = getAppPasswordUrl(email);
	const isValid = localUsername.trim() !== "" && localPassword.trim() !== "";

	useEffect(() => {
		onChange(localUsername, localPassword);
	}, [localUsername, localPassword, onChange]);

	const handleContinue = useCallback(() => {
		if (!isValid) {
			setValidationError("Enter your username and password.");
			return;
		}
		setValidationError(null);
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
			steps={steps}
			activeStep={activeStep}
			title={title}
			subtitle={subtitle}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						{backLabel}
					</Button>
					<Button variant="primary" onClick={handleContinue}>
						{continueLabel}
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				{error && <Banner tone="danger">{error}</Banner>}
				{validationError && (
					<div className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
						{validationError}
					</div>
				)}
				{notice}
				<div>
					<FieldLabel htmlFor="credentials-username">Username</FieldLabel>
					<Input
						id="credentials-username"
						value={localUsername}
						onChange={(e) => {
							setLocalUsername(e.target.value);
							setValidationError(null);
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
							setValidationError(null);
						}}
						autoComplete="current-password"
					/>
				</div>
				<AppPasswordHint url={appPasswordUrl} />
			</div>
		</WizardShell>
	);
}

export interface ConnectionTestStepProps {
	steps: string[];
	activeStep: number;
	email: string;
	imapConfig: ServerConfig;
	smtpConfig: ServerConfig;
	username: string;
	password: string;
	/** Where Back goes when the server refused the credential. */
	onBackToCredentials: () => void;
	/**
	 * Where Back goes when the server could not be reached at all. Onboarding
	 * sends it to the servers step; an import has no such step and sends it back
	 * to the credential, where the account's own settings are editable.
	 */
	onBackToServers: () => void;
	credentialsBackLabel?: string;
	serversBackLabel?: string;
	successLabel?: string;
	onSuccess: () => void;
}

export function ConnectionTestStep({
	steps,
	activeStep,
	email,
	imapConfig,
	smtpConfig,
	username,
	password,
	onSuccess,
	onBackToCredentials,
	onBackToServers,
	credentialsBackLabel = "Back to credentials",
	serversBackLabel = "Back to servers",
	successLabel = "Start syncing",
}: ConnectionTestStepProps) {
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
					{credentialsBackLabel}
				</Button>
				<Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>
					Retry
				</Button>
			</>
		) : phase === "network-failure" ? (
			<>
				<Button variant="ghost" onClick={onBackToServers}>
					{serversBackLabel}
				</Button>
				<Button variant="primary" onClick={() => setAttempt((a) => a + 1)}>
					Retry
				</Button>
			</>
		) : phase === "success" ? (
			<>
				<span className="text-2xs text-fg-subtle">Connection verified</span>
				<Button variant="primary" onClick={onSuccess}>
					{successLabel}
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
			steps={steps}
			activeStep={activeStep}
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
