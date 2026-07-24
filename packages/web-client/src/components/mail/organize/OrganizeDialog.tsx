import { Button, Dialog } from "@remit/ui";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useOrganizeWiden } from "@/hooks/useOrganizeWiden";
import { OrganizeRuleEditor } from "./OrganizeRuleEditor";

interface OrganizeDialogProps {
	open: boolean;
	accountId: string;
	selectedMessageIds: string[];
	/**
	 * Sender addresses of the selected messages, driving the literal fallback on
	 * a deployment without the vector pipeline (semantic-capability.ts).
	 */
	selectedSenders: string[];
	onClose: () => void;
}

/**
 * Smart-organize flow entered from the selection toolbar. Widens the selection
 * once (POST /organize/preview) to seed the rule, then hands off to the chip
 * editor (RFC 038 D1), which counts and commits over the same endpoints. The
 * widen is only the opening count; the editor re-previews every edit.
 */
export function OrganizeDialog({
	open,
	accountId,
	selectedMessageIds,
	selectedSenders,
	onClose,
}: OrganizeDialogProps) {
	const anchorMessageId = selectedMessageIds[0];
	const {
		preview,
		reset,
		matchedCount,
		semanticUnavailable,
		senders,
		isPending,
		isError,
		error,
	} = useOrganizeWiden(accountId, anchorMessageId, selectedSenders);

	useEffect(() => {
		if (!open) return;
		preview();
	}, [open, preview]);

	const handleClose = () => {
		reset();
		onClose();
	};

	if (!open) return null;

	return (
		<Dialog open={open} onClose={handleClose} title="Filter rule">
			{isPending || matchedCount === undefined ? (
				isError ? (
					<div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
						<p className="text-sm font-medium text-danger">
							Couldn't find similar messages
						</p>
						<p className="max-w-xs text-xs text-fg-muted">
							{error instanceof Error ? error.message : "Please try again."}
						</p>
						<Button variant="ghost" onClick={handleClose} className="mt-2">
							Close
						</Button>
					</div>
				) : (
					<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
						<Loader2 className="size-8 animate-spin text-accent-2" />
						<p className="text-sm font-medium text-fg">
							Finding similar messages…
						</p>
					</div>
				)
			) : (
				<OrganizeRuleEditor
					accountId={accountId}
					selectedMessageIds={selectedMessageIds}
					seedCount={matchedCount}
					semanticUnavailable={semanticUnavailable}
					senders={senders}
					onClose={handleClose}
				/>
			)}
		</Dialog>
	);
}
