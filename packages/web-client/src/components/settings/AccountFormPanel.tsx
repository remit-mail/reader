import { zodResolver } from "@hookform/resolvers/zod";
import {
	accountDetailOperationsUpdateAccountMutation,
	accountOperationsCreateAccountMutation,
	accountOperationsTestConnectionMutation,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { Button, Input, Select, securityToApi } from "@remit/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useSignature } from "../../hooks/useSignature";
import {
	getPresetById,
	PROVIDER_PRESETS,
	type ProviderPreset,
} from "../../lib/provider-presets.js";
import { cn } from "../../lib/utils";
import { SlidePanel } from "../ui/SlidePanel";
import {
	appendAppPasswordHint,
	computeSmtpAutoFill,
	deriveSmtpHostFromImap,
} from "./account-form-helpers.js";

/**
 * True when the account authenticates via Microsoft OAuth — not a
 * password-based IMAP account. Used to hide irrelevant credential /
 * server fields and show a read-only summary instead.
 *
 * Exported for unit tests.
 */
export const isOAuthMicrosoftAccount = (
	account: Pick<RemitImapAccountResponse, "authType">,
): boolean => account.authType === "oauthMicrosoft";

// Placeholder shown when editing - indicates password exists but isn't shown
const PASSWORD_PLACEHOLDER = "••••••••••";

/**
 * Derive the initial state of the "use different SMTP credentials" checkbox
 * from a persisted account. Returns true when the account stores an SMTP
 * username distinct from the IMAP username (i.e. the user previously opted
 * in to separate SMTP credentials).
 *
 * The API response intentionally omits the SMTP password, so `smtpUsername`
 * is the only available signal.
 */
export const deriveUseDifferentSmtpCreds = (
	account: Pick<RemitImapAccountResponse, "username"> & {
		smtpUsername?: string;
	},
): boolean => {
	const smtpUsername = account.smtpUsername?.trim();
	if (!smtpUsername) return false;
	return smtpUsername !== account.username;
};

const accountFormSchema = z.object({
	email: z.string().email().min(1, "Email is required"),
	displayName: z.string().optional(),
	username: z.string().optional(),
	password: z.string().optional(),
	imapHost: z.string().min(1, "IMAP host is required"),
	imapPort: z.coerce.number().int().min(1).max(65535),
	imapTls: z.boolean(),
	imapStartTls: z.boolean(),
	smtpHost: z.string().optional(),
	smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
	smtpTls: z.boolean().optional(),
	smtpStartTls: z.boolean().optional(),
	smtpUsername: z.string().optional(),
	smtpPassword: z.string().optional(),
	useDifferentSmtpCreds: z.boolean().optional(),
});

type AccountFormData = z.infer<typeof accountFormSchema>;

interface AccountFormPanelProps {
	isOpen: boolean;
	onClose: () => void;
	account?: RemitImapAccountResponse;
	focusSmtp?: boolean;
}

export const AccountFormPanel = ({
	isOpen,
	onClose,
	account,
	focusSmtp,
}: AccountFormPanelProps) => {
	const queryClient = useQueryClient();
	const isEditing = !!account;

	// Track if user has modified the password field
	const [passwordModified, setPasswordModified] = useState(false);

	// Selected provider preset (empty string = "Custom / other", manual entry)
	const [presetId, setPresetId] = useState("");
	// When a preset is selected its server fields are read-only until the
	// user opts into manual editing via the Advanced toggle.
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const selectedPreset: ProviderPreset | undefined = getPresetById(presetId);
	const serversLocked = !!selectedPreset && !advancedOpen;

	const smtpSectionRef = useRef<HTMLElement | null>(null);

	const form = useForm<AccountFormData>({
		resolver: zodResolver(accountFormSchema),
		defaultValues: {
			email: "",
			displayName: "",
			username: "",
			password: "",
			imapHost: "",
			imapPort: 993,
			imapTls: true,
			imapStartTls: false,
			smtpHost: "",
			smtpPort: 587,
			smtpTls: false,
			smtpStartTls: true,
			useDifferentSmtpCreds: false,
		},
	});

	// Populate form when editing an existing account
	useEffect(() => {
		if (account) {
			const useDifferentSmtpCreds = deriveUseDifferentSmtpCreds(account);
			form.reset({
				email: account.email,
				displayName: account.displayName || "",
				username: account.username || "",
				password: PASSWORD_PLACEHOLDER, // Show placeholder to indicate password exists
				imapHost: account.imapHost,
				imapPort: account.imapPort,
				imapTls: account.imapTls,
				imapStartTls: account.imapStartTls,
				smtpHost: account.smtpHost || "",
				smtpPort: account.smtpPort || 587,
				smtpTls: account.smtpTls || false,
				smtpStartTls: account.smtpStartTls || true,
				smtpUsername: useDifferentSmtpCreds ? account.smtpUsername || "" : "",
				smtpPassword: "",
				useDifferentSmtpCreds,
			});
			setPasswordModified(false);
		} else {
			form.reset({
				email: "",
				displayName: "",
				username: "",
				password: "",
				imapHost: "",
				imapPort: 993,
				imapTls: true,
				imapStartTls: false,
				smtpHost: "",
				smtpPort: 587,
				smtpTls: false,
				smtpStartTls: true,
				useDifferentSmtpCreds: false,
			});
			setPasswordModified(false);
		}
	}, [account, form]);

	const testMutation = useMutation({
		...accountOperationsTestConnectionMutation(),
	});

	const createMutation = useMutation({
		...accountOperationsCreateAccountMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
			onClose();
		},
	});

	const updateMutation = useMutation({
		...accountDetailOperationsUpdateAccountMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
			onClose();
		},
	});

	const handleTestImap = () => {
		const values = form.getValues();
		// If editing and password not modified, send accountId so server uses stored password
		const useStoredPassword = isEditing && !passwordModified;
		testMutation.mutate({
			body: {
				accountId: useStoredPassword ? account?.accountId : undefined,
				username: values.username || values.email,
				password: useStoredPassword ? undefined : values.password || undefined,
				imapHost: values.imapHost,
				imapPort: Number(values.imapPort),
				imapTls: values.imapTls,
				imapStartTls: values.imapStartTls,
			},
		});
	};

	const handleTestSmtp = () => {
		const values = form.getValues();
		// If editing and password not modified, send accountId so server uses stored password
		const useStoredPassword = isEditing && !passwordModified;
		testMutation.mutate({
			body: {
				accountId: useStoredPassword ? account?.accountId : undefined,
				username: values.username || values.email,
				password: useStoredPassword ? undefined : values.password || undefined,
				imapHost: values.imapHost,
				imapPort: Number(values.imapPort),
				imapTls: values.imapTls,
				imapStartTls: values.imapStartTls,
				smtpHost: values.smtpHost || undefined,
				smtpPort: values.smtpPort ? Number(values.smtpPort) : undefined,
				smtpTls: values.smtpTls,
				smtpStartTls: values.smtpStartTls,
				smtpUsername: values.useDifferentSmtpCreds
					? values.smtpUsername
					: undefined,
				smtpPassword: values.useDifferentSmtpCreds
					? values.smtpPassword
					: undefined,
			},
		});
	};

	const handleSubmit = form.handleSubmit((values) => {
		// Validate password for new accounts
		if (!isEditing && !values.password) {
			form.setError("password", { message: "Password is required" });
			return;
		}

		// Safety net: when the user filled IMAP but left SMTP blank,
		// derive sensible SMTP defaults from the IMAP host so the account
		// can actually send mail. Only fills blanks — never overrides
		// values the user typed. See issue #196.
		const autoFill = computeSmtpAutoFill({
			imapHost: values.imapHost,
			smtpHost: values.smtpHost,
			smtpPort: values.smtpPort,
			smtpTls: values.smtpTls,
			smtpStartTls: values.smtpStartTls,
		});
		if (autoFill) {
			form.setValue("smtpHost", autoFill.smtpHost);
			form.setValue("smtpPort", autoFill.smtpPort);
			form.setValue("smtpTls", autoFill.smtpTls);
			form.setValue("smtpStartTls", autoFill.smtpStartTls);
		}

		const effectiveSmtpHost = autoFill?.smtpHost ?? values.smtpHost;
		const effectiveSmtpPort = autoFill?.smtpPort ?? values.smtpPort;
		const effectiveSmtpTls = autoFill?.smtpTls ?? values.smtpTls;
		const effectiveSmtpStartTls = autoFill?.smtpStartTls ?? values.smtpStartTls;

		const baseBody = {
			email: values.email,
			displayName: values.displayName?.trim() || undefined,
			username: values.username || undefined,
			imapHost: values.imapHost,
			imapPort: Number(values.imapPort),
			imapTls: values.imapTls,
			imapStartTls: values.imapStartTls,
			smtpHost: effectiveSmtpHost || undefined,
			smtpPort: effectiveSmtpPort ? Number(effectiveSmtpPort) : undefined,
			smtpTls: effectiveSmtpTls,
			smtpStartTls: effectiveSmtpStartTls,
			smtpUsername: values.useDifferentSmtpCreds
				? values.smtpUsername || undefined
				: undefined,
			smtpPassword: values.useDifferentSmtpCreds
				? values.smtpPassword || undefined
				: undefined,
		};

		if (isEditing && account) {
			const body = {
				...baseBody,
				// Only send password if it was modified
				password: passwordModified ? values.password : undefined,
			};
			updateMutation.mutate({ path: { accountId: account.accountId }, body });
		} else {
			// Password is validated above for new accounts
			const body = {
				...baseBody,
				password: values.password as string,
			};
			createMutation.mutate({ body });
		}
	});

	const isSaving = createMutation.isPending || updateMutation.isPending;

	const {
		signature,
		setSignature,
		isSaving: isSignatureSaving,
	} = useSignature(account?.accountId);
	const [signatureText, setSignatureText] = useState(signature.plainText);

	useEffect(() => {
		setSignatureText(signature.plainText);
	}, [signature.plainText]);

	useEffect(() => {
		if (!isOpen || !focusSmtp) return;
		const el = smtpSectionRef.current;
		if (!el) return;
		const id = window.setTimeout(() => {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
		}, 250);
		return () => window.clearTimeout(id);
	}, [isOpen, focusSmtp]);

	const handleSignatureBlur = useCallback(() => {
		if (signatureText !== signature.plainText) {
			setSignature(signatureText, signatureText);
		}
	}, [signatureText, signature.plainText, setSignature]);

	const handleSecurityChange = (type: "tls" | "starttls" | "none") => {
		const { tls, startTls } = securityToApi(type);
		form.setValue("imapTls", tls);
		form.setValue("imapStartTls", startTls);

		const currentPort = form.getValues("imapPort");
		const isDefaultPort = currentPort === 993 || currentPort === 143;
		if (isDefaultPort) form.setValue("imapPort", type === "tls" ? 993 : 143);
	};

	const handleSmtpSecurityChange = (type: "tls" | "starttls" | "none") => {
		const { tls, startTls } = securityToApi(type);
		form.setValue("smtpTls", tls);
		form.setValue("smtpStartTls", startTls);

		const currentPort = form.getValues("smtpPort");
		const isDefaultPort =
			currentPort === 465 || currentPort === 587 || currentPort === 25;
		if (isDefaultPort) {
			const port = type === "tls" ? 465 : type === "starttls" ? 587 : 25;
			form.setValue("smtpPort", port);
		}
	};

	const handlePrefillFromImap = () => {
		const imapHost = form.getValues("imapHost");
		form.setValue("smtpHost", deriveSmtpHostFromImap(imapHost));
		form.setValue("smtpTls", false);
		form.setValue("smtpStartTls", true);
		form.setValue("smtpPort", 587);
	};

	const handlePresetChange = (id: string) => {
		setPresetId(id);
		setAdvancedOpen(false);
		const preset = getPresetById(id);
		if (!preset) return;

		const imapSecurity = securityToApi(preset.imap.security);
		form.setValue("imapHost", preset.imap.host);
		form.setValue("imapPort", preset.imap.port);
		form.setValue("imapTls", imapSecurity.tls);
		form.setValue("imapStartTls", imapSecurity.startTls);

		const smtpSecurity = securityToApi(preset.smtp.security);
		form.setValue("smtpHost", preset.smtp.host);
		form.setValue("smtpPort", preset.smtp.port);
		form.setValue("smtpTls", smtpSecurity.tls);
		form.setValue("smtpStartTls", smtpSecurity.startTls);

		const email = form.getValues("email").trim();
		const username = form.getValues("username")?.trim();
		if (email && !username) form.setValue("username", email);
	};

	const presetHint = selectedPreset?.passwordHelp.text;
	const imapError = appendAppPasswordHint(
		testMutation.data?.imapError,
		presetHint,
	);
	const smtpError = appendAppPasswordHint(
		testMutation.data?.smtpError,
		presetHint,
	);

	const isOAuthAccount = account ? isOAuthMicrosoftAccount(account) : false;

	// OAuth Microsoft accounts: show a read-only summary panel instead of
	// the credential / server configuration form.
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
								<span className="text-fg">{account?.email}</span>
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
					{isEditing && (
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
										onChange={(e) => setSignatureText(e.target.value)}
										onBlur={handleSignatureBlur}
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
			<form id="account-form" onSubmit={handleSubmit} className="space-y-6">
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
								onChange={(e) => handlePresetChange(e.target.value)}
							>
								<option value="">Custom / other</option>
								{PROVIDER_PRESETS.map((preset) => (
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
							<Input
								id="account-password"
								{...form.register("password", {
									onChange: () => setPasswordModified(true),
								})}
								type="password"
								onFocus={() => {
									// Clear placeholder when user focuses the field
									if (isEditing && !passwordModified) {
										form.setValue("password", "");
										setPasswordModified(true);
									}
								}}
								placeholder={isEditing ? "Leave empty to keep current" : ""}
							/>
							{form.formState.errors.password && (
								<p className="text-sm text-danger mt-1">
									{form.formState.errors.password.message}
								</p>
							)}
							{selectedPreset && (
								<p className="text-xs text-fg-muted mt-1">
									{selectedPreset.passwordHelp.text}{" "}
									<a
										href={selectedPreset.passwordHelp.url}
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
						{selectedPreset && (
							<button
								type="button"
								onClick={() => setAdvancedOpen((v) => !v)}
								className="text-xs text-fg-muted hover:text-fg transition-colors"
							>
								{advancedOpen ? "Use preset settings" : "Advanced"}
							</button>
						)}
					</div>
					{serversLocked && (
						<p className="text-xs text-fg-muted mb-3">
							Server settings are pre-filled for {selectedPreset?.label} and
							locked. Choose Advanced to edit them by hand.
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
											onChange={() => handleSecurityChange("tls")}
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
											onChange={() => handleSecurityChange("starttls")}
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
											onChange={() => handleSecurityChange("none")}
										/>
										None (Unencrypted)
									</label>
								</div>
							</div>
						</div>
						<Button
							type="button"
							variant="secondary"
							onClick={handleTestImap}
							disabled={testMutation.isPending}
							className="w-full"
							icon={
								testMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : undefined
							}
						>
							{testMutation.isPending ? "Testing..." : "Test IMAP Connection"}
						</Button>
						{testMutation.data && (
							<div
								className={cn(
									"p-2 rounded-md text-sm",
									testMutation.data.imapSuccess
										? "bg-positive/10 text-positive"
										: "bg-danger-soft text-danger",
								)}
							>
								{testMutation.data.imapSuccess ? (
									<Check className="inline size-4 mr-1" />
								) : (
									<X className="inline size-4 mr-1" />
								)}
								{testMutation.data.imapSuccess ? "IMAP Connected" : imapError}
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
								onClick={handlePrefillFromImap}
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
											onChange={() => handleSmtpSecurityChange("tls")}
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
											onChange={() => handleSmtpSecurityChange("starttls")}
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
											onChange={() => handleSmtpSecurityChange("none")}
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
									<Input
										id="smtp-username"
										{...form.register("smtpUsername")}
									/>
								</div>
								<div>
									<label
										htmlFor="smtp-password"
										className="text-sm font-medium mb-1.5 block"
									>
										SMTP Password
									</label>
									<Input
										id="smtp-password"
										{...form.register("smtpPassword")}
										type="password"
									/>
								</div>
							</>
						)}
						<Button
							type="button"
							variant="secondary"
							onClick={handleTestSmtp}
							disabled={testMutation.isPending || !form.watch("smtpHost")}
							className="w-full"
							icon={
								testMutation.isPending ? (
									<Loader2 className="size-4 animate-spin" />
								) : undefined
							}
						>
							{testMutation.isPending ? "Testing..." : "Test SMTP Connection"}
						</Button>
						{testMutation.data?.smtpSuccess !== undefined && (
							<div
								className={cn(
									"p-2 rounded-md text-sm",
									testMutation.data.smtpSuccess
										? "bg-positive/10 text-positive"
										: "bg-danger-soft text-danger",
								)}
							>
								{testMutation.data.smtpSuccess ? (
									<Check className="inline size-4 mr-1" />
								) : (
									<X className="inline size-4 mr-1" />
								)}
								{testMutation.data.smtpSuccess ? "SMTP Connected" : smtpError}
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
									onChange={(e) => setSignatureText(e.target.value)}
									onBlur={handleSignatureBlur}
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
			</form>
		</SlidePanel>
	);
};
