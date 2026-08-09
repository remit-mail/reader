import { Check, Loader2, X } from "lucide-react";
import type { FormEvent, ReactNode, RefObject } from "react";
import type { UseFormReturn } from "react-hook-form";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { PasswordInput } from "./password-input.js";
import { Select } from "./select.js";
import type { ServerSecurity } from "./security-select.js";
import { SlidePanel } from "./slide-panel.js";

/**
 * The account credentials form's field shape. `AccountFormPanel` derives its
 * form values from a zod schema that produces this same shape — kept as a
 * plain interface here so this component carries no dependency on zod or on
 * any app-specific schema module.
 */
export interface AccountFormValues {
	email: string;
	displayName?: string;
	username?: string;
	password?: string;
	imapHost: string;
	imapPort: number;
	imapTls: boolean;
	imapStartTls: boolean;
	smtpHost?: string;
	smtpPort?: number;
	smtpTls?: boolean;
	smtpStartTls?: boolean;
	smtpUsername?: string;
	smtpPassword?: string;
	useDifferentSmtpCreds?: boolean;
}

export interface AccountFormTestResult {
	success: boolean;
	message: string;
}

export interface AccountFormProps<TFieldValues extends AccountFormValues> {
	isOpen: boolean;
	onClose: () => void;
	isEditing: boolean;
	isSaving: boolean;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	form: UseFormReturn<TFieldValues>;

	isOAuthAccount: boolean;
	accountEmail?: string;

	providerOptions: { id: string; label: string }[];
	presetId: string;
	onPresetChange: (id: string) => void;
	presetLabel?: string;
	presetPasswordHelp?: { text: string; url: string };
	serversLocked: boolean;
	advancedOpen: boolean;
	onToggleAdvanced: () => void;

	onPasswordFocus: () => void;
	onPasswordModified: () => void;

	onImapSecurityChange: (type: ServerSecurity) => void;
	onTestImap: () => void;
	imapTestPending: boolean;
	imapTestResult?: AccountFormTestResult;

	smtpSectionRef: RefObject<HTMLElement | null>;
	onSmtpSecurityChange: (type: ServerSecurity) => void;
	onPrefillFromImap: () => void;
	onTestSmtp: () => void;
	smtpTestPending: boolean;
	smtpTestResult?: AccountFormTestResult;

	signatureText: string;
	onSignatureChange: (value: string) => void;
	onSignatureBlur: () => void;
	isSignatureSaving: boolean;

	languagesSection: ReactNode;
}

/**
 * The account edit/add form (RFC 021): provider presets, credentials, IMAP
 * and SMTP server settings with connection testing, signature and writing
 * languages. Shared by `AccountFormPanel` (the real, API-wired container)
 * and the workbench Storybook screen, which drives it with local state
 * instead of live mutations.
 */
export function AccountForm<TFieldValues extends AccountFormValues>({
	isOpen,
	onClose,
	isEditing,
	isSaving,
	onSubmit,
	form,
	isOAuthAccount,
	accountEmail,
	providerOptions,
	presetId,
	onPresetChange,
	presetLabel,
	presetPasswordHelp,
	serversLocked,
	advancedOpen,
	onToggleAdvanced,
	onPasswordFocus,
	onPasswordModified,
	onImapSecurityChange,
	onTestImap,
	imapTestPending,
	imapTestResult,
	smtpSectionRef,
	onSmtpSecurityChange,
	onPrefillFromImap,
	onTestSmtp,
	smtpTestPending,
	smtpTestResult,
	signatureText,
	onSignatureChange,
	onSignatureBlur,
	isSignatureSaving,
	languagesSection,
}: AccountFormProps<TFieldValues>) {
	if (isOAuthAccount && isEditing) {
		return (
			<SlidePanel
				isOpen={isOpen}
				onClose={onClose}
				title="Edit Account"
				footer={
					<Button type="button" variant="secondary" onClick={onClose}>
						Close
					</Button>
				}
			>
				<div className="space-y-6">
					<section>
						<h3 className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-3">
							Microsoft 365 Account
						</h3>
						<div className="space-y-3">
							<div className="rounded-md border border-line bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
								<span className="block text-2xs font-medium uppercase tracking-wider text-fg-subtle mb-1">
									Email
								</span>
								<span className="text-fg">{accountEmail}</span>
							</div>
							<div className="rounded-md border border-line bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
								<span className="block text-2xs font-medium uppercase tracking-wider text-fg-subtle mb-1">
									Authentication
								</span>
								<span className="text-fg">Microsoft OAuth (XOAUTH2)</span>
							</div>
							<p className="text-xs text-fg-muted">
								Server settings are managed automatically for Microsoft 365
								accounts. To update credentials, use the Reconnect button.
							</p>
						</div>
					</section>
					<section>
						<h3 className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-3">
							Signature
						</h3>
						<div className="space-y-3">
							<div>
								<label
									htmlFor="email-sig-view"
									className="text-sm font-medium mb-1.5 block"
								>
									Email Signature
								</label>
								<textarea
									id="email-sig-view"
									value={signatureText}
									onChange={(e) => onSignatureChange(e.target.value)}
									onBlur={onSignatureBlur}
									rows={5}
									className="w-full px-3 py-2 border border-line rounded-md bg-surface-sunken text-sm text-fg placeholder:text-fg-subtle focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30 transition-colors resize-y outline-none"
									placeholder="Enter your email signature..."
								/>
								<p className="text-xs text-fg-muted mt-1">
									{isSignatureSaving
										? "Saving signature..."
										: "This signature will be appended to new emails."}
								</p>
							</div>
						</div>
					</section>
					{languagesSection}
				</div>
			</SlidePanel>
		);
	}

	return (
		<SlidePanel
			isOpen={isOpen}
			onClose={onClose}
			title={isEditing ? "Edit Account" : "Add Account"}
			footer={
				<>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="submit"
						form="account-form"
						variant="primary"
						disabled={isSaving}
					>
						{isSaving ? "Saving..." : "Save Account"}
					</Button>
				</>
			}
		>
			<form id="account-form" onSubmit={onSubmit} className="space-y-6">
				{/* Account Information Section */}
				<section>
					<h3 className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-3">
						Account Information
					</h3>
					<div className="space-y-3">
						<div>
							<label
								htmlFor="account-provider"
								className="text-sm font-medium mb-1.5 block"
							>
								Provider
							</label>
							<Select
								id="account-provider"
								value={presetId}
								onChange={(e) => onPresetChange(e.target.value)}
							>
								<option value="">Custom / other</option>
								{providerOptions.map((preset) => (
									<option key={preset.id} value={preset.id}>
										{preset.label}
									</option>
								))}
							</Select>
							<p className="text-xs text-fg-muted mt-1">
								Pick your email provider to fill in server settings
								automatically, or choose Custom to enter them by hand.
							</p>
						</div>
						<div>
							<label
								htmlFor="account-email"
								className="text-sm font-medium mb-1.5 block"
							>
								Email Address
							</label>
							<Input
								id="account-email"
								{...form.register("email")}
								placeholder="alice@example.com"
							/>
							{form.formState.errors.email && (
								<p className="text-sm text-danger mt-1">
									{form.formState.errors.email.message}
								</p>
							)}
						</div>
						<div>
							<label
								htmlFor="account-displayName"
								className="text-sm font-medium mb-1.5 block"
							>
								Display name (optional)
							</label>
							<Input
								id="account-displayName"
								{...form.register("displayName")}
								placeholder="Alice"
							/>
							<p className="text-xs text-fg-muted mt-1">
								What to call this account in Remit. Leave blank to use a name
								derived from the address.
							</p>
						</div>
						<div>
							<label
								htmlFor="account-username"
								className="text-sm font-medium mb-1.5 block"
							>
								Username
							</label>
							<Input
								id="account-username"
								{...form.register("username")}
								placeholder="Same as email if empty"
							/>
						</div>
						<div>
							<label
								htmlFor="account-password"
								className="text-sm font-medium mb-1.5 block"
							>
								Password
							</label>
							<PasswordInput
								id="account-password"
								{...form.register("password", { onChange: onPasswordModified })}
								onFocus={onPasswordFocus}
								placeholder={isEditing ? "Leave empty to keep current" : ""}
							/>
							{form.formState.errors.password && (
								<p className="text-sm text-danger mt-1">
									{form.formState.errors.password.message}
								</p>
							)}
							{presetPasswordHelp && (
								<p className="text-xs text-fg-muted mt-1">
									{presetPasswordHelp.text}{" "}
									<a
										href={presetPasswordHelp.url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-accent hover:underline"
									>
										Get an app password
									</a>
								</p>
							)}
						</div>
					</div>
				</section>

				{/* IMAP Settings */}
				<section>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider">
							Incoming Mail (IMAP)
						</h3>
						{presetLabel && (
							<button
								type="button"
								onClick={onToggleAdvanced}
								className="text-xs text-fg-muted hover:text-fg transition-colors"
							>
								{advancedOpen ? "Use preset settings" : "Advanced"}
							</button>
						)}
					</div>
					{serversLocked && (
						<p className="text-xs text-fg-muted mb-3">
							Server settings are pre-filled for {presetLabel} and locked.
							Choose Advanced to edit them by hand.
						</p>
					)}
					<div className="space-y-3">
						<div>
							<label
								htmlFor="imap-host"
								className="text-sm font-medium mb-1.5 block"
							>
								Server
							</label>
							<Input
								id="imap-host"
								{...form.register("imapHost")}
								readOnly={serversLocked}
								placeholder="imap.example.com"
							/>
							{form.formState.errors.imapHost && (
								<p className="text-sm text-danger mt-1">
									{form.formState.errors.imapHost.message}
								</p>
							)}
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label
									htmlFor="imap-port"
									className="text-sm font-medium mb-1.5 block"
								>
									Port
								</label>
								<Input
									id="imap-port"
									{...form.register("imapPort")}
									readOnly={serversLocked}
									type="number"
								/>
							</div>
							<div>
								<span className="text-sm font-medium mb-1.5 block">
									Security
								</span>
								<div className="space-y-1.5 mt-2">
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											disabled={serversLocked}
											checked={form.watch("imapTls")}
											onChange={() => onImapSecurityChange("tls")}
										/>
										TLS (Port 993)
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											disabled={serversLocked}
											checked={
												!form.watch("imapTls") && form.watch("imapStartTls")
											}
											onChange={() => onImapSecurityChange("starttls")}
										/>
										STARTTLS (Port 143)
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											disabled={serversLocked}
											checked={
												!form.watch("imapTls") && !form.watch("imapStartTls")
											}
											onChange={() => onImapSecurityChange("none")}
										/>
										None (Unencrypted)
									</label>
								</div>
							</div>
						</div>
						<Button
							type="button"
							variant="secondary"
							onClick={onTestImap}
							disabled={imapTestPending}
							className="w-full"
							icon={
								imapTestPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : undefined
							}
						>
							{imapTestPending ? "Testing..." : "Test IMAP Connection"}
						</Button>
						{imapTestResult && (
							<div
								className={cn(
									"p-2 rounded-md text-sm",
									imapTestResult.success
										? "bg-positive/10 text-positive"
										: "bg-danger-soft text-danger",
								)}
							>
								{imapTestResult.success ? (
									<Check className="inline size-4 mr-1" />
								) : (
									<X className="inline size-4 mr-1" />
								)}
								{imapTestResult.message}
							</div>
						)}
					</div>
				</section>

				{/* SMTP Settings */}
				<section ref={smtpSectionRef} data-testid="smtp-section">
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider">
							Outgoing Mail (SMTP)
						</h3>
						{!serversLocked && (
							<button
								type="button"
								onClick={onPrefillFromImap}
								disabled={!form.watch("imapHost")}
								className="text-xs text-fg-muted hover:text-fg transition-colors disabled:opacity-50"
							>
								Pre-fill from IMAP
							</button>
						)}
					</div>
					<div className="space-y-3">
						<div>
							<label
								htmlFor="smtp-host"
								className="text-sm font-medium mb-1.5 block"
							>
								Server
							</label>
							<Input
								id="smtp-host"
								{...form.register("smtpHost")}
								readOnly={serversLocked}
								placeholder="smtp.example.com"
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label
									htmlFor="smtp-port"
									className="text-sm font-medium mb-1.5 block"
								>
									Port
								</label>
								<Input
									id="smtp-port"
									{...form.register("smtpPort")}
									readOnly={serversLocked}
									type="number"
								/>
							</div>
							<div>
								<span className="text-sm font-medium mb-1.5 block">
									Security
								</span>
								<div className="space-y-1.5 mt-2">
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											disabled={serversLocked}
											checked={form.watch("smtpTls") === true}
											onChange={() => onSmtpSecurityChange("tls")}
										/>
										TLS (Port 465)
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											disabled={serversLocked}
											checked={
												!form.watch("smtpTls") &&
												form.watch("smtpStartTls") === true
											}
											onChange={() => onSmtpSecurityChange("starttls")}
										/>
										STARTTLS (Port 587)
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											disabled={serversLocked}
											checked={
												!form.watch("smtpTls") && !form.watch("smtpStartTls")
											}
											onChange={() => onSmtpSecurityChange("none")}
										/>
										None (Unencrypted)
									</label>
								</div>
							</div>
						</div>
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								{...form.register("useDifferentSmtpCreds")}
							/>
							Use different credentials for SMTP
						</label>
						{form.watch("useDifferentSmtpCreds") && (
							<>
								<div>
									<label
										htmlFor="smtp-username"
										className="text-sm font-medium mb-1.5 block"
									>
										SMTP Username
									</label>
									<Input id="smtp-username" {...form.register("smtpUsername")} />
								</div>
								<div>
									<label
										htmlFor="smtp-password"
										className="text-sm font-medium mb-1.5 block"
									>
										SMTP Password
									</label>
									<PasswordInput
										id="smtp-password"
										{...form.register("smtpPassword")}
									/>
								</div>
							</>
						)}
						<Button
							type="button"
							variant="secondary"
							onClick={onTestSmtp}
							disabled={smtpTestPending || !form.watch("smtpHost")}
							className="w-full"
							icon={
								smtpTestPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : undefined
							}
						>
							{smtpTestPending ? "Testing..." : "Test SMTP Connection"}
						</Button>
						{smtpTestResult && (
							<div
								className={cn(
									"p-2 rounded-md text-sm",
									smtpTestResult.success
										? "bg-positive/10 text-positive"
										: "bg-danger-soft text-danger",
								)}
							>
								{smtpTestResult.success ? (
									<Check className="inline size-4 mr-1" />
								) : (
									<X className="inline size-4 mr-1" />
								)}
								{smtpTestResult.message}
							</div>
						)}
					</div>
				</section>

				{isEditing && (
					<section>
						<h3 className="text-2xs font-semibold text-fg-subtle uppercase tracking-wider mb-3">
							Signature
						</h3>
						<div className="space-y-3">
							<div>
								<label
									htmlFor="email-sig-edit"
									className="text-sm font-medium mb-1.5 block"
								>
									Email Signature
								</label>
								<textarea
									id="email-sig-edit"
									value={signatureText}
									onChange={(e) => onSignatureChange(e.target.value)}
									onBlur={onSignatureBlur}
									rows={5}
									className="w-full px-3 py-2 border border-line rounded-md bg-surface-sunken text-sm text-fg placeholder:text-fg-subtle focus-within:border-line-strong focus-within:ring-2 focus-within:ring-ring/30 transition-colors resize-y outline-none"
									placeholder="Enter your email signature..."
								/>
								<p className="text-xs text-fg-muted mt-1">
									{isSignatureSaving
										? "Saving signature..."
										: "This signature will be appended to new emails."}
								</p>
							</div>
						</div>
					</section>
				)}
				{isEditing && languagesSection}
			</form>
		</SlidePanel>
	);
}
