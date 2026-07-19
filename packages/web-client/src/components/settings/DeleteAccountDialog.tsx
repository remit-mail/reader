import {
	meOperationsCreateExportMutation,
	meOperationsDeleteMeMutation,
} from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { Button, Dialog, Input } from "@remit/ui";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Download, X } from "lucide-react";
import { useState } from "react";
import { useAuthProvider } from "@/auth/provider";

interface DeleteAccountDialogProps {
	open: boolean;
	onClose: () => void;
}

interface DeleteAccountDialogViewProps extends DeleteAccountDialogProps {
	accountEmail: string;
	signOut: () => void | Promise<void>;
}

function DeleteAccountDialogView({
	open,
	onClose,
	accountEmail,
	signOut,
}: DeleteAccountDialogViewProps) {
	const [confirmEmail, setConfirmEmail] = useState("");
	const [mismatch, setMismatch] = useState(false);
	const [deleted, setDeleted] = useState(false);

	const mutation = useMutation({
		...meOperationsDeleteMeMutation(),
		onSuccess: () => {
			setDeleted(true);
			setTimeout(() => signOut(), 2000);
		},
	});

	const exportMutation = useMutation(meOperationsCreateExportMutation());

	const handleClose = () => {
		if (mutation.isPending) return;
		setConfirmEmail("");
		setMismatch(false);
		setDeleted(false);
		mutation.reset();
		exportMutation.reset();
		onClose();
	};

	const handleDelete = () => {
		if (confirmEmail.trim().toLowerCase() !== accountEmail.toLowerCase()) {
			setMismatch(true);
			return;
		}
		setMismatch(false);
		mutation.mutate({ body: { confirmEmail: confirmEmail.trim() } });
	};

	return (
		<Dialog open={open} onClose={handleClose} title="Delete your Remit account">
			<header className="flex items-center gap-2 border-b border-line px-5 py-3">
				<AlertTriangle className="size-4 shrink-0 text-danger" />
				<span className="flex-1 text-sm font-semibold text-fg">
					Delete your Remit account
				</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<X className="size-3.5" />}
					onClick={handleClose}
					aria-label="Cancel"
				/>
			</header>

			{deleted ? (
				<div className="px-5 py-6 text-sm text-fg-muted">
					<p className="font-medium text-fg">Account deletion scheduled.</p>
					<p className="mt-1">
						Your data will be erased shortly. Signing you out…
					</p>
				</div>
			) : (
				<>
					<div className="space-y-4 px-5 py-4 text-sm text-fg-muted">
						<p>This permanently erases everything Remit holds for you:</p>
						<ul className="space-y-1.5 text-xs">
							<li className="flex gap-2">
								<span className="text-danger">•</span>
								All connected accounts disconnected and access tokens revoked.
							</li>
							<li className="flex gap-2">
								<span className="text-danger">•</span>
								Synced mail cache and search index.
							</li>
							<li className="flex gap-2">
								<span className="text-danger">•</span>
								AI history and insights.
							</li>
							<li className="flex gap-2">
								<span className="text-danger">•</span>
								Preferences and rules.
							</li>
						</ul>

						<div className="rounded-sm border border-line bg-surface-sunken px-3 py-2 text-xs">
							<strong className="text-fg">
								Your mail at Gmail / IMAP is not deleted.
							</strong>{" "}
							This only removes Remit's copy and its access — the mail stays in
							your provider mailboxes.
						</div>

						<div className="text-xs">
							<button
								type="button"
								onClick={() => exportMutation.mutate({})}
								aria-busy={exportMutation.isPending}
								className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
							>
								<Download className="size-3.5" />
								{exportMutation.isPending
									? "Requesting export…"
									: "Export my data first"}
							</button>
							{exportMutation.isSuccess && (
								// biome-ignore lint/a11y/useSemanticElements: <p> with role="status" preserves block layout; <output> is inline
								<p className="mt-1.5 text-fg-muted" role="status">
									Export requested. We'll prepare a ZIP of your mail — find it
									under your data exports when it's ready.
								</p>
							)}
							{exportMutation.isError && (
								<p className="mt-1.5 text-danger" role="alert">
									Couldn't start the export. Please try again.
								</p>
							)}
						</div>

						<div>
							<label
								htmlFor="confirm-remit-email"
								className="mb-1 block text-xs font-medium text-fg"
							>
								Type{" "}
								<span className="font-mono text-fg-muted">{accountEmail}</span>{" "}
								to confirm
							</label>
							<Input
								id="confirm-remit-email"
								type="email"
								placeholder={accountEmail}
								value={confirmEmail}
								onChange={(e) => {
									setConfirmEmail(e.target.value);
									if (mismatch) setMismatch(false);
									if (mutation.isError) mutation.reset();
								}}
								autoComplete="off"
							/>
							{mismatch && (
								<p className="mt-1.5 text-xs text-danger" role="alert">
									That doesn't match your account email. Type it exactly to
									confirm.
								</p>
							)}
							{mutation.isError && (
								<p className="mt-1.5 text-xs text-danger" role="alert">
									{mutation.error instanceof Error
										? mutation.error.message
										: "Something went wrong. Please try again."}
								</p>
							)}
						</div>
					</div>

					<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
						<Button variant="secondary" size="sm" onClick={handleClose}>
							Cancel
						</Button>
						<Button
							variant="danger"
							size="sm"
							onClick={handleDelete}
							aria-busy={mutation.isPending}
						>
							{mutation.isPending ? "Deleting…" : "Delete everything"}
						</Button>
					</footer>
				</>
			)}
		</Dialog>
	);
}

/**
 * Delete-account dialog. Safe to mount anywhere — `DangerZone` renders it
 * unconditionally on the settings/accounts route. Identity comes from the
 * composed auth provider's `Account` render-prop; when no session is active
 * (e2e / visual harness / signed out) it falls back to the view with an empty
 * identity and a no-op `signOut`.
 */
export function DeleteAccountDialog(props: DeleteAccountDialogProps) {
	const { Account } = useAuthProvider();
	return (
		<Account
			fallback={
				<DeleteAccountDialogView
					{...props}
					accountEmail=""
					signOut={() => {}}
				/>
			}
		>
			{({ email, signOut }) => (
				<DeleteAccountDialogView
					{...props}
					accountEmail={email ?? ""}
					signOut={signOut}
				/>
			)}
		</Account>
	);
}
