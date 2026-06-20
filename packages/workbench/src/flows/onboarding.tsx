import {
	AppPasswordHint,
	Banner,
	Button,
	CheckRow,
	ConnectorTile,
	FieldLabel,
	Input,
	Kbd,
	Select,
	ServerFields,
	WizardShell,
} from "@remit/ui";
import { AtSign, Inbox, Loader2, Mail, Server } from "lucide-react";

/**
 * Onboarding wizard steps as static compositions (doc/design/flows/
 * 01-onboarding.md). One component per step; the stories render one each.
 * The same steps are reused by Settings → Accounts → "Add account".
 */

export const steps = [
	"Connector",
	"Address",
	"Servers",
	"Credentials",
	"Test",
	"Sync",
];

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

export function StepWelcome({ onNext }: StepNav = {}) {
	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			hideSteps
			title="Welcome to Remit"
			subtitle="One inbox for all your mail, with context about every message."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						<Kbd>Enter</Kbd> to continue
					</span>
					<Button variant="primary" onClick={onNext}>
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

export function StepConnector({
	selected = "imap",
	onBack,
	onNext,
}: { selected?: "imap" | "microsoft" } & StepNav) {
	const microsoft = selected === "microsoft";
	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			title="How does this account connect?"
			subtitle="Choose a sign-in method. IMAP works with any provider."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" onClick={onNext}>
						{microsoft ? "Continue with Microsoft" : "Continue with IMAP"}
					</Button>
				</>
			}
		>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<ConnectorTile
					name="IMAP / SMTP"
					description="Any mail provider — Fastmail, iCloud, your own server."
					icon={<Server className="size-5" />}
					selected={!microsoft}
					onSelect={() => {}}
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
					selected={microsoft}
					onSelect={() => {}}
				/>
			</div>
		</WizardShell>
	);
}

export function StepMicrosoftEmail({ onBack, onNext }: StepNav = {}) {
	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			title="Sign in with Microsoft"
			subtitle="You'll be redirected to Microsoft to sign in securely."
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
			<div className="space-y-3">
				<div>
					<FieldLabel htmlFor="ms-email">Email address (optional)</FieldLabel>
					<Input
						id="ms-email"
						icon={<AtSign className="size-4" />}
						placeholder="you@outlook.com"
					/>
					<p className="mt-1.5 text-2xs text-fg-subtle">
						Pre-fills the Microsoft sign-in form. Leave blank to choose on the
						Microsoft page.
					</p>
				</div>
			</div>
		</WizardShell>
	);
}

export function StepAddress({
	discovering,
	error,
	onBack,
	onNext,
}: { discovering?: boolean; error?: string } & StepNav) {
	return (
		<WizardShell
			steps={steps}
			activeStep={1}
			title="What's the email address?"
			subtitle="We'll detect the server settings for you."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" disabled={discovering} onClick={onNext}>
						Continue
					</Button>
				</>
			}
		>
			<div>
				<FieldLabel htmlFor="address-email">Email address</FieldLabel>
				<Input
					id="address-email"
					icon={<AtSign className="size-4" />}
					placeholder="you@example.com"
					defaultValue={
						error ? "alice@" : discovering ? "alice@fastmail.example" : ""
					}
				/>
				{discovering && (
					<div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
						<Loader2 className="size-3.5 animate-spin text-accent" />
						Looking up settings for fastmail.example…
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

export function StepServers({
	detected = true,
	preset = false,
	error,
	onBack,
	onNext,
}: { detected?: boolean; preset?: boolean; error?: string } & StepNav) {
	const detectedBadge = !preset && detected;
	return (
		<WizardShell
			steps={steps}
			activeStep={2}
			title="Confirm server settings"
			subtitle={
				preset
					? "Pick your provider to fill in the right settings — or choose Custom to enter them by hand."
					: detected
						? "Found via autodiscovery — adjust anything that looks off."
						: "We couldn't detect settings for example.com — enter them manually."
			}
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" onClick={onNext}>
						Continue
					</Button>
				</>
			}
		>
			<div className="space-y-5">
				{error && <Banner tone="danger">{error}</Banner>}
				{preset && (
					<div>
						<FieldLabel htmlFor="provider-select">Provider</FieldLabel>
						<Select id="provider-select" defaultValue="icloud">
							<option value="">Custom / other</option>
							<option value="icloud">iCloud</option>
							<option value="yahoo">Yahoo</option>
							<option value="aol">AOL</option>
							<option value="fastmail">Fastmail</option>
						</Select>
						<p className="mt-1 text-2xs text-fg-subtle">
							Server settings are pre-filled for iCloud and locked. Choose
							Advanced to edit them by hand.
						</p>
					</div>
				)}
				<ServerFields
					legend="IMAP — incoming"
					badge={
						preset
							? { label: "preset", tone: "neutral" }
							: detectedBadge
								? { label: "detected", tone: "positive" }
								: undefined
					}
					readOnly={preset}
					host={
						preset
							? "imap.mail.me.com"
							: detected
								? "imap.fastmail.example"
								: ""
					}
					port={preset || detected ? "993" : ""}
					security="tls"
					hostPlaceholder="imap.example.com"
					portPlaceholder="993"
				/>
				<ServerFields
					legend="SMTP — outgoing"
					badge={
						preset
							? { label: "preset", tone: "neutral" }
							: detectedBadge
								? { label: "detected", tone: "positive" }
								: undefined
					}
					readOnly={preset}
					host={
						preset
							? "smtp.mail.me.com"
							: detected
								? "smtp.fastmail.example"
								: ""
					}
					port={preset || detected ? "587" : ""}
					security="starttls"
					hostPlaceholder="smtp.example.com"
					portPlaceholder="587"
				/>
				{preset && (
					<p className="text-2xs text-fg-subtle">
						iCloud requires an app-specific password, not your Apple ID
						password.{" "}
						<a
							href="https://support.apple.com/en-us/102654"
							className="text-accent underline"
						>
							Get an app password
						</a>
					</p>
				)}
			</div>
		</WizardShell>
	);
}

export function StepCredentials({ onBack, onNext }: StepNav = {}) {
	return (
		<WizardShell
			steps={steps}
			activeStep={3}
			title="Sign in to fastmail.example"
			subtitle="Many providers require an app password instead of your normal one."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" onClick={onNext}>
						Test connection
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				<div>
					<FieldLabel htmlFor="credentials-username">Username</FieldLabel>
					<Input
						id="credentials-username"
						defaultValue="alice@fastmail.example"
					/>
				</div>
				<div>
					<FieldLabel htmlFor="credentials-password">
						Password or app password
					</FieldLabel>
					<Input
						id="credentials-password"
						type="password"
						defaultValue="••••••••••••"
					/>
				</div>
				<AppPasswordHint url="#app-passwords" />
			</div>
		</WizardShell>
	);
}

type TestMode = "success" | "auth-failure" | "network-failure";

export function StepTest({
	mode,
	failed,
	onBack,
	onNext,
}: { mode?: TestMode; failed?: boolean } & StepNav) {
	// `failed` is kept for back-compat with the auth-failure story.
	const phase: TestMode = mode ?? (failed ? "auth-failure" : "success");
	const networkFailure = phase === "network-failure";

	const footer =
		phase === "auth-failure" ? (
			<>
				<Button variant="ghost" onClick={onBack}>
					Back to credentials
				</Button>
				<Button variant="primary">Retry</Button>
			</>
		) : networkFailure ? (
			<>
				<Button variant="ghost" onClick={onBack}>
					Back to servers
				</Button>
				<Button variant="primary">Retry</Button>
			</>
		) : (
			<>
				<span className="text-2xs text-fg-subtle">Connection verified</span>
				<Button variant="primary" onClick={onNext}>
					Start syncing
				</Button>
			</>
		);

	return (
		<WizardShell
			steps={steps}
			activeStep={4}
			title="Testing the connection"
			subtitle="Checking alice@fastmail.example"
			footer={footer}
		>
			<div className="divide-y divide-line">
				<CheckRow
					label="IMAP — imap.fastmail.example:993"
					detail={
						networkFailure
							? "Couldn't reach the server."
							: "Connected, TLS verified, 7 mailboxes visible"
					}
					state={networkFailure ? "failed" : "ok"}
				/>
				{phase === "auth-failure" ? (
					<>
						<CheckRow
							label="SMTP — smtp.fastmail.example:587"
							detail="Authentication failed. Check your password — many providers require an app password."
							state="failed"
						/>
						<div className="py-3">
							<p className="mb-2 text-xs text-fg-muted">
								Check your password — many providers require an app password.
							</p>
							<RawError>535 5.7.8 Authentication credentials invalid</RawError>
						</div>
					</>
				) : networkFailure ? (
					<>
						<CheckRow
							label="SMTP — smtp.fastmail.example:587"
							detail="Couldn't reach the server."
							state="failed"
						/>
						<div className="py-3">
							<RawError>
								ECONNREFUSED imap.fastmail.example:993 — connection refused
							</RawError>
						</div>
					</>
				) : (
					<CheckRow
						label="SMTP — smtp.fastmail.example:587"
						detail="Connected, STARTTLS upgraded, sender accepted"
						state="ok"
					/>
				)}
			</div>
		</WizardShell>
	);
}

export function StepSync({
	mode = "progress",
	onNext,
}: { mode?: "progress" | "create-error" | "stalled" } & StepNav) {
	if (mode === "create-error") {
		return (
			<WizardShell
				steps={steps}
				activeStep={5}
				title="Couldn't create account"
				subtitle="Something went wrong saving your account."
				footer={
					<>
						<span />
						<Button variant="primary">Retry</Button>
					</>
				}
			>
				<RawError>
					500 Internal Server Error — failed to persist account
				</RawError>
			</WizardShell>
		);
	}

	const stalled = mode === "stalled";

	return (
		<WizardShell
			steps={steps}
			activeStep={5}
			title="Syncing alice@fastmail.example"
			subtitle="Newest mail first — you can start reading right away."
			footer={
				<>
					<span className="text-2xs text-fg-subtle">
						Sync continues in the background
					</span>
					<Button variant="primary" onClick={onNext}>
						Go to inbox
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				<div>
					<div className="flex items-baseline justify-between text-xs">
						<span className="font-medium text-fg">INBOX</span>
						<span className="text-fg-subtle tabular-nums">
							812 / 4,210 messages
						</span>
					</div>
					<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
						<div className="h-full w-1/5 rounded-full bg-accent" />
					</div>
				</div>
				<div className="divide-y divide-line">
					<CheckRow
						label="Mailboxes discovered"
						detail="7 mailboxes found"
						state={stalled ? "failed" : "ok"}
					/>
					<CheckRow
						label="INBOX"
						detail={stalled ? "Stalled" : "Syncing newest first…"}
						state={stalled ? "failed" : "running"}
					/>
					<CheckRow
						label="Archive, Sent, Drafts…"
						detail="Queued"
						state="pending"
					/>
				</div>
				{stalled && (
					<div className="mt-2 space-y-2">
						<p className="text-xs text-danger">
							Sync stalled. The account is still active —{" "}
							<button type="button" className="underline">
								retry
							</button>
						</p>
						<RawError>IMAP connection dropped mid-sync (timeout)</RawError>
					</div>
				)}
			</div>
		</WizardShell>
	);
}
