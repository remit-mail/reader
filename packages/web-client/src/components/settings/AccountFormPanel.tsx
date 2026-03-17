import { zodResolver } from "@hookform/resolvers/zod";
import {
	accountDetailOperationsUpdateAccountMutation,
	accountOperationsCreateAccountMutation,
	accountOperationsTestConnectionMutation,
	configOperationsGetConfigQueryKey,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "../../lib/utils";
import { SlidePanel } from "../ui/SlidePanel";

// Placeholder shown when editing - indicates password exists but isn't shown
const PASSWORD_PLACEHOLDER = "••••••••••";

const accountFormSchema = z.object({
	email: z.string().email().min(1, "Email is required"),
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
}

export const AccountFormPanel = ({
	isOpen,
	onClose,
	account,
}: AccountFormPanelProps) => {
	const queryClient = useQueryClient();
	const isEditing = !!account;

	// Track if user has modified the password field
	const [passwordModified, setPasswordModified] = useState(false);

	const form = useForm<AccountFormData>({
		resolver: zodResolver(accountFormSchema),
		defaultValues: {
			email: "",
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
			form.reset({
				email: account.email,
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
				useDifferentSmtpCreds: false,
			});
			setPasswordModified(false);
		} else {
			form.reset({
				email: "",
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
			toast.success("Account created successfully");
			onClose();
		},
		onError: () => {
			toast.error("Failed to create account");
		},
	});

	const updateMutation = useMutation({
		...accountDetailOperationsUpdateAccountMutation(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: configOperationsGetConfigQueryKey(),
			});
			toast.success("Account updated successfully");
			onClose();
		},
		onError: () => {
			toast.error("Failed to update account");
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

		const baseBody = {
			email: values.email,
			username: values.username || undefined,
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

	const handleSecurityChange = (type: "tls" | "starttls" | "none") => {
		const currentPort = form.getValues("imapPort");
		const isDefaultPort = currentPort === 993 || currentPort === 143;

		if (type === "tls") {
			form.setValue("imapTls", true);
			form.setValue("imapStartTls", false);
			if (isDefaultPort) form.setValue("imapPort", 993);
		} else if (type === "starttls") {
			form.setValue("imapTls", false);
			form.setValue("imapStartTls", true);
			if (isDefaultPort) form.setValue("imapPort", 143);
		} else {
			form.setValue("imapTls", false);
			form.setValue("imapStartTls", false);
			if (isDefaultPort) form.setValue("imapPort", 143);
		}
	};

	const handleSmtpSecurityChange = (type: "tls" | "starttls" | "none") => {
		const currentPort = form.getValues("smtpPort");
		const isDefaultPort =
			currentPort === 465 || currentPort === 587 || currentPort === 25;

		if (type === "tls") {
			form.setValue("smtpTls", true);
			form.setValue("smtpStartTls", false);
			if (isDefaultPort) form.setValue("smtpPort", 465);
		} else if (type === "starttls") {
			form.setValue("smtpTls", false);
			form.setValue("smtpStartTls", true);
			if (isDefaultPort) form.setValue("smtpPort", 587);
		} else {
			form.setValue("smtpTls", false);
			form.setValue("smtpStartTls", false);
			if (isDefaultPort) form.setValue("smtpPort", 25);
		}
	};

	const handlePrefillFromImap = () => {
		const imapHost = form.getValues("imapHost");
		const smtpHost = imapHost.replace(/^imap\./i, "smtp.");
		form.setValue("smtpHost", smtpHost);
		form.setValue("smtpTls", false);
		form.setValue("smtpStartTls", true);
		form.setValue("smtpPort", 587);
	};

	return (
		<SlidePanel
			isOpen={isOpen}
			onClose={onClose}
			title={isEditing ? "Edit Account" : "Add Account"}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 border rounded-md hover:bg-accent"
					>
						Cancel
					</button>
					<button
						type="submit"
						form="account-form"
						disabled={isSaving}
						className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
					>
						{isSaving ? "Saving..." : "Save Account"}
					</button>
				</>
			}
		>
			<form id="account-form" onSubmit={handleSubmit} className="space-y-6">
				{/* Account Information Section */}
				<section>
					<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
						Account Information
					</h3>
					<div className="space-y-3">
						<div>
							<label className="text-sm font-medium mb-1.5 block">
								Email Address
							</label>
							<input
								{...form.register("email")}
								className="w-full px-3 py-2 border rounded-md bg-background"
								placeholder="alice@example.com"
							/>
							{form.formState.errors.email && (
								<p className="text-sm text-red-600 mt-1">
									{form.formState.errors.email.message}
								</p>
							)}
						</div>
						<div>
							<label className="text-sm font-medium mb-1.5 block">
								Username
							</label>
							<input
								{...form.register("username")}
								className="w-full px-3 py-2 border rounded-md bg-background"
								placeholder="Same as email if empty"
							/>
						</div>
						<div>
							<label className="text-sm font-medium mb-1.5 block">
								Password
							</label>
							<input
								{...form.register("password", {
									onChange: () => setPasswordModified(true),
								})}
								type="password"
								className="w-full px-3 py-2 border rounded-md bg-background"
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
								<p className="text-sm text-red-600 mt-1">
									{form.formState.errors.password.message}
								</p>
							)}
						</div>
					</div>
				</section>

				{/* IMAP Settings */}
				<section>
					<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
						Incoming Mail (IMAP)
					</h3>
					<div className="space-y-3">
						<div>
							<label className="text-sm font-medium mb-1.5 block">Server</label>
							<input
								{...form.register("imapHost")}
								className="w-full px-3 py-2 border rounded-md bg-background"
								placeholder="imap.example.com"
							/>
							{form.formState.errors.imapHost && (
								<p className="text-sm text-red-600 mt-1">
									{form.formState.errors.imapHost.message}
								</p>
							)}
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="text-sm font-medium mb-1.5 block">Port</label>
								<input
									{...form.register("imapPort")}
									type="number"
									className="w-full px-3 py-2 border rounded-md bg-background"
								/>
							</div>
							<div>
								<label className="text-sm font-medium mb-1.5 block">
									Security
								</label>
								<div className="space-y-1.5 mt-2">
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											checked={form.watch("imapTls")}
											onChange={() => handleSecurityChange("tls")}
										/>
										TLS (Port 993)
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
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
						<button
							type="button"
							onClick={handleTestImap}
							disabled={testMutation.isPending}
							className="w-full py-2 border rounded-md hover:bg-accent flex items-center justify-center gap-2"
						>
							{testMutation.isPending ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Testing...
								</>
							) : (
								"Test IMAP Connection"
							)}
						</button>
						{testMutation.data && (
							<div
								className={cn(
									"p-2 rounded-md text-sm",
									testMutation.data.imapSuccess
										? "bg-green-50 text-green-700"
										: "bg-red-50 text-red-700",
								)}
							>
								{testMutation.data.imapSuccess ? (
									<Check className="inline size-4 mr-1" />
								) : (
									<X className="inline size-4 mr-1" />
								)}
								{testMutation.data.imapSuccess
									? "IMAP Connected"
									: testMutation.data.imapError}
							</div>
						)}
					</div>
				</section>

				{/* SMTP Settings */}
				<section>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
							Outgoing Mail (SMTP)
						</h3>
						<button
							type="button"
							onClick={handlePrefillFromImap}
							disabled={!form.watch("imapHost")}
							className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
						>
							Pre-fill from IMAP
						</button>
					</div>
					<div className="space-y-3">
						<div>
							<label className="text-sm font-medium mb-1.5 block">Server</label>
							<input
								{...form.register("smtpHost")}
								className="w-full px-3 py-2 border rounded-md bg-background"
								placeholder="smtp.example.com"
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className="text-sm font-medium mb-1.5 block">Port</label>
								<input
									{...form.register("smtpPort")}
									type="number"
									className="w-full px-3 py-2 border rounded-md bg-background"
								/>
							</div>
							<div>
								<label className="text-sm font-medium mb-1.5 block">
									Security
								</label>
								<div className="space-y-1.5 mt-2">
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
											checked={form.watch("smtpTls") === true}
											onChange={() => handleSmtpSecurityChange("tls")}
										/>
										TLS (Port 465)
									</label>
									<label className="flex items-center gap-2 text-sm">
										<input
											type="radio"
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
									<label className="text-sm font-medium mb-1.5 block">
										SMTP Username
									</label>
									<input
										{...form.register("smtpUsername")}
										className="w-full px-3 py-2 border rounded-md bg-background"
									/>
								</div>
								<div>
									<label className="text-sm font-medium mb-1.5 block">
										SMTP Password
									</label>
									<input
										{...form.register("smtpPassword")}
										type="password"
										className="w-full px-3 py-2 border rounded-md bg-background"
									/>
								</div>
							</>
						)}
						<button
							type="button"
							onClick={handleTestSmtp}
							disabled={testMutation.isPending || !form.watch("smtpHost")}
							className="w-full py-2 border rounded-md hover:bg-accent flex items-center justify-center gap-2 disabled:opacity-50"
						>
							{testMutation.isPending ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Testing...
								</>
							) : (
								"Test SMTP Connection"
							)}
						</button>
						{testMutation.data?.smtpSuccess !== undefined && (
							<div
								className={cn(
									"p-2 rounded-md text-sm",
									testMutation.data.smtpSuccess
										? "bg-green-50 text-green-700"
										: "bg-red-50 text-red-700",
								)}
							>
								{testMutation.data.smtpSuccess ? (
									<Check className="inline size-4 mr-1" />
								) : (
									<X className="inline size-4 mr-1" />
								)}
								{testMutation.data.smtpSuccess
									? "SMTP Connected"
									: testMutation.data.smtpError}
							</div>
						)}
					</div>
				</section>
			</form>
		</SlidePanel>
	);
};
