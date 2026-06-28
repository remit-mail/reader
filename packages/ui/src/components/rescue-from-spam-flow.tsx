import { CheckCircle2, HelpCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Banner } from "./banner.js";
import { BottomSheet } from "./bottom-sheet.js";
import { Button } from "./button.js";
import {
	type MoveMailboxOption,
	MoveMailboxPicker,
} from "./move-mailbox-picker.js";
import {
	type RescueCandidate,
	RescueCandidateRow,
} from "./rescue-candidate-row.js";

type Step = "review" | "destination" | "done";

export interface RescueFromSpamFlowProps {
	open: boolean;
	/** Suspected-safe messages, already shaped and explained by the app. */
	candidates: RescueCandidate[];
	/** Where the move lands unless the user picks another folder. */
	defaultDestinationId: string;
	/** Folders the user can send the rescued mail to. */
	availableFolders: MoveMailboxOption[];
	/** Run the move. The flow shows the done state right after. */
	onConfirmMove: (messageIds: string[], destinationId: string) => void;
	/** Close the sheet without moving anything. */
	onCancel: () => void;
}

const plural = (n: number): string => (n === 1 ? "message" : "messages");

/**
 * Plain-language scope line shown before the move commits, so the user sees
 * exactly what happens and that it is a one-off — never an ongoing rule.
 */
export const rescueMoveConsequence = (
	count: number,
	destinationLabel: string,
): string =>
	`Moves ${count === 1 ? "this message" : `these ${count} ${plural(count)}`} out of Spam to ${destinationLabel} now. Nothing later.`;

const folderLabel = (folders: MoveMailboxOption[], id: string): string =>
	folders.find((f) => f.id === id)?.label ?? "Inbox";

function ExplainWhy() {
	return (
		<Banner tone="info" variant="soft">
			<p className="text-2xs text-fg-muted">
				We list a message here only when we can confirm the sender is who they
				say — usually someone you've emailed before, write to often, or a
				service that consistently checks out. We never guess from words in the
				subject. Anything we can't confirm stays in Spam.
			</p>
		</Banner>
	);
}

function ReviewStep({
	candidates,
	selected,
	onToggle,
	onSelectAll,
	onSelectNone,
	onContinue,
	onCancel,
}: {
	candidates: RescueCandidate[];
	selected: Set<string>;
	onToggle: (id: string) => void;
	onSelectAll: () => void;
	onSelectNone: () => void;
	onContinue: () => void;
	onCancel: () => void;
}) {
	const [showWhy, setShowWhy] = useState(false);
	const count = selected.size;
	return (
		<div className="flex min-h-0 flex-col">
			<div className="px-row-inset pb-2 pt-1">
				<div className="flex items-start justify-between gap-2">
					<h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
						<ShieldCheck className="size-4 text-positive" aria-hidden />
						Rescue from Spam
					</h2>
					<Button
						variant="ghost"
						size="sm"
						icon={<HelpCircle className="size-3.5" />}
						onClick={() => setShowWhy((v) => !v)}
						className="-mr-1.5 -mt-0.5"
					>
						Why these?
					</Button>
				</div>
				<p className="mt-1 text-2xs text-fg-subtle">
					These look safe — from senders we can verify. Uncheck anything that
					belongs in Spam.
				</p>
				{showWhy && (
					<div className="mt-2">
						<ExplainWhy />
					</div>
				)}
			</div>

			<div className="flex items-center justify-between px-row-inset pb-1.5">
				<span className="text-2xs font-medium text-fg-muted">
					{`${count} of ${candidates.length} selected`}
				</span>
				<span className="flex gap-1">
					<Button variant="ghost" size="sm" onClick={onSelectAll}>
						Select all
					</Button>
					<Button variant="ghost" size="sm" onClick={onSelectNone}>
						Select none
					</Button>
				</span>
			</div>

			<div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto border-y border-line">
				{candidates.map((candidate) => (
					<RescueCandidateRow
						key={candidate.id}
						candidate={candidate}
						selected={selected.has(candidate.id)}
						onToggle={() => onToggle(candidate.id)}
					/>
				))}
			</div>

			<div className="space-y-2 border-t border-line bg-surface px-row-inset py-3">
				<Button
					variant="primary"
					onClick={onContinue}
					className="h-11 w-full font-semibold"
				>
					{`Continue with ${count} ${plural(count)}`}
				</Button>
				<Button variant="ghost" onClick={onCancel} className="h-11 w-full">
					Cancel
				</Button>
			</div>
		</div>
	);
}

function DestinationStep({
	count,
	folders,
	destination,
	onPick,
	onMove,
	onBack,
}: {
	count: number;
	folders: MoveMailboxOption[];
	destination: string;
	onPick: (id: string) => void;
	onMove: () => void;
	onBack: () => void;
}) {
	const [picking, setPicking] = useState(false);

	return (
		<div className="flex min-h-0 flex-col">
			<div className="px-row-inset pb-2 pt-1">
				<h2 className="text-sm font-semibold text-fg">Where should they go?</h2>
				<p className="mt-1 text-2xs text-fg-subtle">
					Pick a folder, then we move them out of Spam.
				</p>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-row-inset py-2">
				{picking ? (
					<div className="overflow-hidden rounded-xl border border-line bg-surface">
						<MoveMailboxPicker
							mailboxes={folders}
							autoFocus
							onSelect={(id) => {
								onPick(id);
								setPicking(false);
							}}
							onCancel={() => setPicking(false)}
						/>
					</div>
				) : (
					<div className="rounded-xl border border-line bg-surface-sunken p-3">
						<p className="text-2xs text-fg-subtle">Destination</p>
						<p className="mt-0.5 text-sm font-medium text-fg">
							{folderLabel(folders, destination)}
						</p>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setPicking(true)}
							className="mt-2 px-0"
						>
							Move to a different folder
						</Button>
					</div>
				)}
			</div>

			<div className="space-y-2 border-t border-line bg-surface px-row-inset py-3">
				<p className="text-2xs text-fg-subtle">
					{rescueMoveConsequence(count, folderLabel(folders, destination))}
				</p>
				<Button
					variant="primary"
					onClick={onMove}
					className="h-11 w-full font-semibold"
				>
					{`Move ${count} out of Spam`}
				</Button>
				<Button variant="ghost" onClick={onBack} className="h-11 w-full">
					Back
				</Button>
			</div>
		</div>
	);
}

function DoneStep({
	count,
	destinationLabel,
	onClose,
}: {
	count: number;
	destinationLabel: string;
	onClose: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex flex-1 flex-col items-center justify-center gap-3 px-row-inset py-10 text-center">
				<CheckCircle2 className="size-10 text-positive" aria-hidden />
				<p className="text-base font-semibold text-fg">
					{`Moved ${count} ${plural(count)} out of Spam.`}
				</p>
				<p className="text-2xs text-fg-subtle">
					{`You'll find them in ${destinationLabel}.`}
				</p>
			</div>
			<div className="border-t border-line bg-surface px-row-inset py-3">
				<Button
					variant="primary"
					onClick={onClose}
					className="h-11 w-full font-semibold"
				>
					Done
				</Button>
			</div>
		</div>
	);
}

/**
 * Review-and-rescue flow for messages that landed in Spam but come from senders
 * we can verify. Presentational and fully driven: the app supplies candidates,
 * folders and the move callback; the sheet owns only selection and step state.
 *
 * Pre-selects every candidate, supports select-all / none, explains "why these"
 * on demand, states the move's scope as a one-off consequence, and always
 * offers a way back before committing.
 */
export function RescueFromSpamFlow({
	open,
	candidates,
	defaultDestinationId,
	availableFolders,
	onConfirmMove,
	onCancel,
}: RescueFromSpamFlowProps) {
	const [step, setStep] = useState<Step>("review");
	const [selected, setSelected] = useState<Set<string>>(() =>
		open ? new Set(candidates.map((c) => c.id)) : new Set(),
	);
	const [destination, setDestination] = useState(defaultDestinationId);
	const [movedCount, setMovedCount] = useState(0);

	const wasOpen = useRef(false);
	useEffect(() => {
		if (open && !wasOpen.current) {
			setStep("review");
			setSelected(new Set(candidates.map((c) => c.id)));
			setDestination(defaultDestinationId);
			setMovedCount(0);
		}
		wasOpen.current = open;
	}, [open, candidates, defaultDestinationId]);

	const selectedCount = selected.size;

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const move = () => {
		const ids = Array.from(selected);
		setMovedCount(ids.length);
		onConfirmMove(ids, destination);
		setStep("done");
	};

	return (
		<BottomSheet open={open} onClose={onCancel} dismissLabel="Close rescue">
			{step === "review" && (
				<ReviewStep
					candidates={candidates}
					selected={selected}
					onToggle={toggle}
					onSelectAll={() => setSelected(new Set(candidates.map((c) => c.id)))}
					onSelectNone={() => setSelected(new Set())}
					onContinue={() => setStep("destination")}
					onCancel={onCancel}
				/>
			)}
			{step === "destination" && (
				<DestinationStep
					count={selectedCount}
					folders={availableFolders}
					destination={destination}
					onPick={setDestination}
					onMove={move}
					onBack={() => setStep("review")}
				/>
			)}
			{step === "done" && (
				<DoneStep
					count={movedCount}
					destinationLabel={folderLabel(availableFolders, destination)}
					onClose={onCancel}
				/>
			)}
		</BottomSheet>
	);
}
