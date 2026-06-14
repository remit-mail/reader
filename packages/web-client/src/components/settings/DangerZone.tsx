import { Button } from "@remit/ui";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

export function DangerZone() {
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<>
			<div className="mt-8 rounded-sm border border-danger/50">
				<div className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2">
					<AlertTriangle className="size-4 text-danger" />
					<h2 className="text-sm font-semibold text-danger">Danger zone</h2>
				</div>
				<div className="flex items-center justify-between gap-4 px-4 py-3">
					<div className="min-w-0">
						<div className="text-sm font-medium text-fg">
							Delete your Remit account
						</div>
						<p className="text-xs text-fg-muted">
							Disconnects every account and erases Remit's copy of your mail,
							insights and preferences. Your mail at the providers is untouched.
						</p>
					</div>
					<Button
						variant="danger"
						size="sm"
						className="shrink-0"
						onClick={() => setDialogOpen(true)}
					>
						Delete account
					</Button>
				</div>
			</div>

			<DeleteAccountDialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
			/>
		</>
	);
}
