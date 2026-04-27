import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import {
	AlertTriangle,
	Check,
	Mail,
	Pencil,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTriggerSync } from "../../hooks/useTriggerSync";
import { cn } from "../../lib/utils";
import { ErrorState } from "../ui/ErrorState";
import { accountIsMissingSmtp } from "./account-form-helpers.js";

interface AccountCardProps {
	account: RemitImapAccountResponse;
	onEdit: (options?: { focusSmtp?: boolean }) => void;
	onDelete: () => void;
}

const REFRESH_LOCKOUT_MS = 3000;

export const AccountCard = ({
	account,
	onEdit,
	onDelete,
}: AccountCardProps) => {
	const isConnected = account.connectionState === "authenticated";
	const hasError = account.lastError !== undefined;
	const missingSmtp = accountIsMissingSmtp(account);
	const { trigger, isPending, error, reset } = useTriggerSync(
		account.accountId,
	);
	// Local cooldown so accidental double-clicks don't fire two SQS sends
	// while the (very fast) trigger ack is in flight.
	const [cooldown, setCooldown] = useState(false);

	useEffect(() => {
		if (!cooldown) return;
		const timer = setTimeout(() => setCooldown(false), REFRESH_LOCKOUT_MS);
		return () => clearTimeout(timer);
	}, [cooldown]);

	const handleRefresh = () => {
		if (cooldown || isPending) return;
		setCooldown(true);
		trigger();
	};

	const refreshDisabled = cooldown || isPending;

	return (
		<div className="border border-border rounded-lg p-4">
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-3">
					<div className="p-2 rounded-full bg-accent">
						<Mail className="size-5" />
					</div>
					<div>
						<h3 className="font-medium">{account.email}</h3>
						<p className="text-sm text-muted-foreground">
							{account.imapHost}:{account.imapPort}{" "}
							{account.imapTls ? "(TLS)" : "(STARTTLS)"}
						</p>
					</div>
				</div>

				<div
					className={cn(
						"flex items-center gap-1 text-sm",
						isConnected
							? "text-green-600"
							: hasError
								? "text-red-600"
								: "text-muted-foreground",
					)}
				>
					{isConnected ? (
						<Check className="size-4" />
					) : hasError ? (
						<X className="size-4" />
					) : null}
					{isConnected ? "Connected" : hasError ? "Error" : "Disconnected"}
				</div>
			</div>

			{hasError && (
				<p className="mt-2 text-sm text-red-600">{account.lastError}</p>
			)}

			{account.lastSyncAt && (
				<p className="mt-2 text-xs text-muted-foreground">
					Last sync: {new Date(account.lastSyncAt).toLocaleString()}
				</p>
			)}

			{missingSmtp && (
				<button
					type="button"
					onClick={() => onEdit({ focusSmtp: true })}
					data-testid="account-card-smtp-warning"
					className="mt-3 w-full flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 dark:bg-amber-500/20 px-3 py-2 text-left hover:bg-amber-500/20 dark:hover:bg-amber-500/30 transition-colors"
				>
					<AlertTriangle
						className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
						aria-hidden="true"
					/>
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium text-amber-700 dark:text-amber-300">
							Can't send mail — configure SMTP
						</p>
						<p className="text-xs text-muted-foreground mt-0.5">
							Outgoing mail isn't set up for this account. Click to add SMTP
							settings.
						</p>
					</div>
				</button>
			)}

			{error && (
				<div className="mt-3">
					<ErrorState
						variant="inline"
						title="Couldn't refresh mailboxes"
						error={error}
						onRetry={() => {
							reset();
							handleRefresh();
						}}
					/>
				</div>
			)}

			<div className="flex justify-end gap-2 mt-4">
				<button
					type="button"
					onClick={handleRefresh}
					disabled={refreshDisabled}
					aria-label={`Refresh mailboxes for ${account.email}`}
					className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
				>
					<RefreshCw
						className={cn("size-3", isPending && "animate-spin")}
						aria-hidden="true"
					/>
					Refresh mailboxes
				</button>
				<button
					type="button"
					onClick={() => onEdit()}
					className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded-md hover:bg-accent"
				>
					<Pencil className="size-3" />
					Edit
				</button>
				<button
					type="button"
					onClick={onDelete}
					className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50"
				>
					<Trash2 className="size-3" />
					Delete
				</button>
			</div>
		</div>
	);
};
