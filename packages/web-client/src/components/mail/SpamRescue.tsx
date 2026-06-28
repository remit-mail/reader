import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type MoveMailboxOption,
	RescueBanner,
	type RescueCandidate,
	RescueFromSpamFlow,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInboxMailbox } from "@/hooks/useArchiveMailbox";
import {
	getMailboxDisplayLabel,
	getMailboxDisplayName,
} from "@/lib/mailbox-order";
import { buildMoveTargets } from "@/lib/move-targets";

interface SpamRescueProps {
	accountId: string;
	currentMailboxId: string;
	candidates: RescueCandidate[];
	onMove: (messageIds: string[], destinationId: string) => void;
	children: ReactNode;
}

/**
 * Wraps the Spam folder list with the Rescue-from-Spam call-to-action and flow.
 * Renders the banner above the list and the review sheet over it; the kit flow
 * stays presentational, this component supplies the real folders, destination
 * and move. Only mount it on the Spam folder when candidates exist.
 */
export function SpamRescue({
	accountId,
	currentMailboxId,
	candidates,
	onMove,
	children,
}: SpamRescueProps) {
	const [open, setOpen] = useState(false);
	const { t } = useTranslation("mail", { useSuspense: false });
	const translator = useCallback(
		(key: string, fallback: string): string =>
			t(key, { defaultValue: fallback }),
		[t],
	);

	const { inboxMailboxId } = useInboxMailbox(accountId);

	const { data: mailboxesResponse } = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		staleTime: Infinity,
	});

	const folders = useMemo<MoveMailboxOption[]>(() => {
		const targets = buildMoveTargets(mailboxesResponse?.items ?? []);
		return targets.map((mailbox) => ({
			id: mailbox.mailboxId,
			label:
				getMailboxDisplayLabel(
					mailbox.fullPath,
					mailbox.specialUse,
					translator,
				) || getMailboxDisplayName(mailbox.fullPath),
			searchValue: mailbox.fullPath,
			isCurrent: mailbox.mailboxId === currentMailboxId,
		}));
	}, [mailboxesResponse?.items, currentMailboxId, translator]);

	const defaultDestinationId = useMemo(() => {
		if (inboxMailboxId) return inboxMailboxId;
		const inbox = folders.find((f) => f.label.toLowerCase() === "inbox");
		return inbox?.id ?? folders.find((f) => !f.isCurrent)?.id ?? "";
	}, [inboxMailboxId, folders]);

	const handleConfirmMove = useCallback(
		(messageIds: string[], destinationId: string) => {
			onMove(messageIds, destinationId);
		},
		[onMove],
	);

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div className="shrink-0 px-row-inset pt-2">
				<RescueBanner
					count={candidates.length}
					onReview={() => setOpen(true)}
				/>
			</div>
			<div className="min-h-0 flex-1">{children}</div>
			<RescueFromSpamFlow
				open={open}
				candidates={candidates}
				defaultDestinationId={defaultDestinationId}
				availableFolders={folders}
				onConfirmMove={handleConfirmMove}
				onCancel={() => setOpen(false)}
			/>
		</div>
	);
}
