import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { Check, Mail, Pencil, Trash2, X } from "lucide-react";
import { cn } from "../../lib/utils";

interface AccountCardProps {
	account: RemitImapAccountResponse;
	onEdit: () => void;
	onDelete: () => void;
}

export const AccountCard = ({
	account,
	onEdit,
	onDelete,
}: AccountCardProps) => {
	const isConnected = account.connectionState === "authenticated";
	const hasError = account.lastError !== undefined;

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

			<div className="flex justify-end gap-2 mt-4">
				<button
					type="button"
					onClick={onEdit}
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
