import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { BottomSheet, Button } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOrganizePreview } from "@/hooks/useOrganizePreview";
import { getMailboxDisplayName } from "@/lib/folder-roles";
import { buildMoveTargets } from "@/lib/move-targets";
import {
	type OrganizeEntry,
	type OrganizeSeed,
	type PreviewStatus,
	resolveOrganizeStage,
} from "@/lib/organize/mobile-organize-flow";
import { OrganizePanel } from "./OrganizePanel";
import { SomethingElsePanel } from "./SomethingElsePanel";

interface MobileOrganizeFlowProps {
	entry: OrganizeEntry;
	accountId: string;
	mailboxId: string;
	selectedMessageIds: string[];
	junkMailboxId?: string;
	/** Close the flow and return to the list — dismiss, "Not now", and Done all use it. */
	onClose: () => void;
}

const previewStatusOf = (
	isError: boolean,
	isPending: boolean,
	matchedCount: number | undefined,
): PreviewStatus => {
	if (isError) return "error";
	if (isPending) return "pending";
	return matchedCount !== undefined ? "success" : "idle";
};

/**
 * The guided select-similar → organize flow, the mobile home for organizing
 * (issue #211). Entered from the selection sheet, it widens the selection once
 * with the read-only matcher (POST /organize/preview), shows a brief widening
 * state, and renders the organize sentence inside a bottom sheet on that
 * widened set — the same {@link OrganizePanel} the desktop dialog uses, so the
 * two never drift. "Something else" collects a folder/scope seed first; a widen
 * that matches nothing falls back to organizing the selection. Desktop keeps
 * its `OrganizeDialog` — this is the touch surface only.
 */
export function MobileOrganizeFlow({
	entry,
	accountId,
	mailboxId,
	selectedMessageIds,
	junkMailboxId,
	onClose,
}: MobileOrganizeFlowProps) {
	const anchorMessageId = selectedMessageIds[0];
	const [seed, setSeed] = useState<OrganizeSeed | undefined>();

	const { preview, matchedCount, isPending, isError, error } =
		useOrganizePreview(accountId);

	useEffect(() => {
		if (!anchorMessageId) return;
		preview({ anchorMessageId, matchOperator: "And", literalClauses: [] });
	}, [anchorMessageId, preview]);

	const { data: mailboxesData } = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		staleTime: Number.POSITIVE_INFINITY,
	});

	const folderOptions = useMemo(
		() =>
			buildMoveTargets(mailboxesData?.items ?? []).map((mailbox) => ({
				id: mailbox.mailboxId,
				label: getMailboxDisplayName(mailbox.fullPath),
			})),
		[mailboxesData?.items],
	);

	const stage = resolveOrganizeStage({
		entry,
		hasSeed: seed !== undefined,
		previewStatus: previewStatusOf(isError, isPending, matchedCount),
		matchedCount,
	});

	return (
		<BottomSheet open onClose={onClose} dismissLabel="Dismiss organize">
			{stage.kind === "something-else" && (
				<SomethingElsePanel
					folderOptions={folderOptions}
					junkMailboxId={junkMailboxId}
					onSeed={setSeed}
				/>
			)}

			{stage.kind === "widening" && <WideningState />}

			{stage.kind === "error" && (
				<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
					<p className="text-sm font-medium text-danger">
						Couldn't find similar messages
					</p>
					<p className="max-w-xs text-xs text-fg-muted">
						{error instanceof Error ? error.message : "Please try again."}
					</p>
					<Button variant="ghost" onClick={onClose} className="mt-2">
						Close
					</Button>
				</div>
			)}

			{stage.kind === "organize" && (
				<OrganizePanel
					accountId={accountId}
					mailboxId={mailboxId}
					selectedMessageIds={selectedMessageIds}
					anchorMessageId={anchorMessageId}
					matchedCount={stage.matchedCount}
					initialScope={seed?.scope}
					seedMailboxId={seed?.moveMailboxId}
					fallback={stage.fallback}
					onClose={onClose}
				/>
			)}
		</BottomSheet>
	);
}

function WideningState() {
	return (
		<div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
			<Loader2 className="size-8 animate-spin text-accent-2" />
			<p className="text-sm font-medium text-fg">Finding similar messages…</p>
		</div>
	);
}
