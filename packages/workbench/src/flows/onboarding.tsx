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

function FieldLabel({ children }: { children: string }) {
	return (
		<span className="mb-1 block text-xs font-medium text-fg-muted">
			{children}
		</span>
	);
}

/**
 * Connection security as one decision per server. The choice maps to the
 * two booleans on the Account API: tls=true (TLS/SSL), startTls=true
 * (STARTTLS), both false (None).
 */
function SecuritySelect({ defaultValue }: { defaultValue: string }) {
	return (
		<Select defaultValue={defaultValue}>
			<option value="tls">TLS/SSL</option>
			<option value="starttls">STARTTLS</option>
			<option value="none">None (insecure)</option>
		</Select>
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

export function StepConnector({ onBack, onNext }: StepNav = {}) {
	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			title="How does this account connect?"
			subtitle="IMAP works with any provider today. OAuth connectors are on the way."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" onClick={onNext}>
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

export function StepAddress({
	discovering,
	onBack,
	onNext,
}: { discovering?: boolean } & StepNav) {
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
				<FieldLabel>Email address</FieldLabel>
				<Input
					icon={<AtSign className="size-4" />}
					placeholder="you@example.com"
					defaultValue={discovering ? "alice@fastmail.example" : ""}
				/>
				{discovering && (
					<div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
						<Loader2 className="size-3.5 animate-spin text-accent" />
						Looking up settings for fastmail.example…
					</div>
				)}
			</div>
		</WizardShell>
	);
}

export function StepServers({
	detected = true,
	preset = false,
	onBack,
	onNext,
}: { detected?: boolean; preset?: boolean } & StepNav) {
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
				{preset && (
					<div>
						<FieldLabel>Provider</FieldLabel>
						<Select defaultValue="icloud">
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
				<fieldset>
					<legend className="flex items-center gap-2 text-sm font-semibold text-fg">
						IMAP — incoming
						{preset && <Badge tone="neutral">preset</Badge>}
						{!preset && detected && <Badge tone="positive">detected</Badge>}
					</legend>
					<div className="mt-2 grid grid-cols-[1fr_6rem_8rem] gap-2">
						<div>
							<FieldLabel>Host</FieldLabel>
							<Input
								readOnly={preset}
								defaultValue={
									preset
										? "imap.mail.me.com"
										: detected
											? "imap.fastmail.example"
											: ""
								}
								placeholder="imap.example.com"
							/>
						</div>
						<div>
							<FieldLabel>Port</FieldLabel>
							<Input
								readOnly={preset}
								defaultValue={preset ? "993" : detected ? "993" : ""}
								placeholder="993"
							/>
						</div>
						<div>
							<FieldLabel>Security</FieldLabel>
							{/* maps to imapTls / imapStartTls on the Account API */}
							<SecuritySelect defaultValue="tls" />
						</div>
					</div>
				</fieldset>
				<fieldset>
					<legend className="flex items-center gap-2 text-sm font-semibold text-fg">
						SMTP — outgoing
						{preset && <Badge tone="neutral">preset</Badge>}
						{!preset && detected && <Badge tone="positive">detected</Badge>}
					</legend>
					<div className="mt-2 grid grid-cols-[1fr_6rem_8rem] gap-2">
						<div>
							<FieldLabel>Host</FieldLabel>
							<Input
								readOnly={preset}
								defaultValue={
									preset
										? "smtp.mail.me.com"
										: detected
											? "smtp.fastmail.example"
											: ""
								}
								placeholder="smtp.example.com"
							/>
						</div>
						<div>
							<FieldLabel>Port</FieldLabel>
							<Input
								readOnly={preset}
								defaultValue={preset ? "587" : detected ? "587" : ""}
								placeholder="587"
							/>
						</div>
						<div>
							<FieldLabel>Security</FieldLabel>
							{/* maps to smtpTls / smtpStartTls on the Account API */}
							<SecuritySelect defaultValue="starttls" />
						</div>
					</div>
				</fieldset>
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
					<FieldLabel>Username</FieldLabel>
					<Input defaultValue="alice@fastmail.example" />
				</div>
				<div>
					<FieldLabel>Password or app password</FieldLabel>
					<Input type="password" defaultValue="••••••••••••" />
				</div>
				<p className="text-2xs text-fg-subtle">
					Stored encrypted, used only to connect to your mail server.{" "}
					<a href="#app-passwords" className="text-accent underline">
						How to create an app password
					</a>
				</p>
			</div>
		</WizardShell>
	);
}

export function StepTest({
	failed,
	onBack,
	onNext,
}: { failed?: boolean } & StepNav) {
	return (
		<WizardShell
			steps={steps}
			activeStep={4}
			title="Testing the connection"
			subtitle="Two quick checks against your servers."
			footer={
				failed ? (
					<>
						<Button variant="ghost" onClick={onBack}>
							Back to credentials
						</Button>
						<Button variant="primary">Retry</Button>
					</>
				) : (
					<>
						<span className="text-2xs text-fg-subtle">All good</span>
						<Button variant="primary" onClick={onNext}>
							Start syncing
						</Button>
					</>
				)
			}
		>
			<div className="divide-y divide-line">
				<CheckRow
					label="IMAP — imap.fastmail.example:993"
					detail="Connected, TLS verified, 7 mailboxes visible"
					state="ok"
				/>
				{failed ? (
					<>
						<CheckRow
							label="SMTP — smtp.fastmail.example:587"
							detail="Authentication failed. Check your password — many providers require an app password."
							state="failed"
						/>
						<div className="py-3">
							<code className="block rounded bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
								535 5.7.8 Authentication credentials invalid
							</code>
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

export function StepSync({ onNext }: StepNav = {}) {
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
						state="ok"
					/>
					<CheckRow
						label="INBOX"
						detail="Syncing newest first…"
						state="running"
					/>
					<CheckRow
						label="Archive, Sent, Drafts…"
						detail="Queued"
						state="pending"
					/>
				</div>
			</div>
		</WizardShell>
	);
}
