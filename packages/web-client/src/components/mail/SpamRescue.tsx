import { mailboxOperationsListMailboxesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	RescueBanner,
	type RescueCandidate,
	RescueFromSpamFlow,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	useFolderAppointments,
	useInboxMailbox,
} from "@/hooks/useArchiveMailbox";
import { useFolderLabelTranslator } from "@/hooks/useFolderLabelTranslator";
import {
	buildMoveOptions,
	folderDelimiter,
	type MoveDestination,
} from "@/lib/move-options";
import {
	recordRescueCandidatesSurfaced,
	recordRescueCommitted,
	recordRescueFlowOpened,
} from "@/lib/rescue-telemetry";
import { useTelemetry } from "@/lib/telemetry-context";

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
	const telemetry = useTelemetry();
	const translator = useFolderLabelTranslator();

	const { inboxMailboxId } = useInboxMailbox(accountId);
	const folderAppointments = useFolderAppointments(accountId);

	const { data: mailboxesResponse } = useQuery({
		...mailboxOperationsListMailboxesOptions({ path: { accountId } }),
		staleTime: Infinity,
	});

	const folders = useMemo<MoveDestination[]>(
		() =>
			buildMoveOptions({
				mailboxes: mailboxesResponse?.items ?? [],
				folderAppointments,
				currentMailboxId,
				translator,
			}),
		[
			mailboxesResponse?.items,
			folderAppointments,
			currentMailboxId,
			translator,
		],
	);

	const defaultDestinationId = useMemo(() => {
		if (inboxMailboxId) return inboxMailboxId;
		const inbox = folders.find((f) => f.label.toLowerCase() === "inbox");
		return inbox?.id ?? folders.find((f) => !f.isCurrent)?.id ?? "";
	}, [inboxMailboxId, folders]);

	const surfacedRef = useRef(false);
	useEffect(() => {
		if (surfacedRef.current) return;
		surfacedRef.current = true;
		recordRescueCandidatesSurfaced(telemetry, candidates.length);
	}, [telemetry, candidates.length]);

	const handleReview = useCallback(() => {
		recordRescueFlowOpened(telemetry, candidates.length);
		setOpen(true);
	}, [telemetry, candidates.length]);

	const handleConfirmMove = useCallback(
		(messageIds: string[], destinationId: string) => {
			recordRescueCommitted(telemetry, {
				selected: messageIds.length,
				total: candidates.length,
				toInbox: destinationId === inboxMailboxId,
			});
			onMove(messageIds, destinationId);
		},
		[telemetry, candidates.length, inboxMailboxId, onMove],
	);

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div className="shrink-0 px-row-inset pt-2">
				<RescueBanner count={candidates.length} onReview={handleReview} />
			</div>
			<div className="min-h-0 flex-1">{children}</div>
			<RescueFromSpamFlow
				open={open}
				candidates={candidates}
				defaultDestinationId={defaultDestinationId}
				availableFolders={folders}
				delimiter={folderDelimiter(mailboxesResponse?.items ?? [])}
				onConfirmMove={handleConfirmMove}
				onCancel={() => setOpen(false)}
			/>
		</div>
	);
}
