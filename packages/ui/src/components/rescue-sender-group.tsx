import { ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn.js";
import { Avatar } from "./avatar.js";
import { Badge } from "./badge.js";
import { Checkbox } from "./checkbox.js";
import {
	type RescueCandidate,
	RescueCandidateRow,
} from "./rescue-candidate-row.js";
import { SenderTrustIndicator } from "./sender-trust-indicator.js";

/** Every suspected-safe message from one sender, as one reviewable unit. */
export interface RescueSenderGroup {
	/** Lowercased sender address — stable identity for the group. */
	key: string;
	senderName: string;
	senderAddress: string;
	trustReason: string;
	trustSubReason: string;
	senderTrust?: RescueCandidate["senderTrust"];
	messages: RescueCandidate[];
}

/**
 * Collapse the candidate list into one entry per sender.
 *
 * Trust is a property of the sender, not of the individual message, so a flat
 * list makes the user answer the same question once per message — 342 messages
 * from a few dozen senders is a few dozen real decisions padded out into
 * hundreds of identical ones. Grouping restores the decision to its actual
 * granularity.
 *
 * Groups are ordered by message count descending, so the senders that account
 * for most of the queue are settled first; ties keep the order the messages
 * arrived in.
 */
export const groupRescueCandidatesBySender = (
	candidates: RescueCandidate[],
): RescueSenderGroup[] => {
	const groups = new Map<string, RescueSenderGroup>();
	const order: string[] = [];

	for (const candidate of candidates) {
		const key = (candidate.senderAddress || candidate.senderName).toLowerCase();
		const existing = groups.get(key);
		if (existing) {
			existing.messages.push(candidate);
			continue;
		}
		groups.set(key, {
			key,
			senderName: candidate.senderName,
			senderAddress: candidate.senderAddress,
			trustReason: candidate.trustReason,
			trustSubReason: candidate.trustSubReason,
			senderTrust: candidate.senderTrust,
			messages: [candidate],
		});
		order.push(key);
	}

	return order
		.map((key) => groups.get(key) as RescueSenderGroup)
		.sort((a, b) => b.messages.length - a.messages.length);
};

export type GroupSelectionState = "none" | "some" | "all";

export const senderGroupSelectionState = (
	group: RescueSenderGroup,
	selected: Set<string>,
): GroupSelectionState => {
	const count = group.messages.filter((m) => selected.has(m.id)).length;
	if (count === 0) return "none";
	if (count === group.messages.length) return "all";
	return "some";
};

export interface RescueSenderGroupRowProps {
	group: RescueSenderGroup;
	selected: Set<string>;
	/** Select or deselect every message from this sender at once. */
	onToggleGroup: (group: RescueSenderGroup, nextSelected: boolean) => void;
	onToggleMessage: (id: string) => void;
}

const plural = (n: number): string => (n === 1 ? "message" : "messages");

/**
 * One sender in the Rescue-from-Spam review list: a single decision covering
 * every message that sender has sitting in Spam. The individual messages stay
 * available behind a disclosure for the cases where a sender is trusted but one
 * particular message is not.
 */
export function RescueSenderGroupRow({
	group,
	selected,
	onToggleGroup,
	onToggleMessage,
}: RescueSenderGroupRowProps) {
	const [expanded, setExpanded] = useState(false);
	const state = senderGroupSelectionState(group, selected);
	const count = group.messages.length;
	const Chevron = expanded ? ChevronDown : ChevronRight;

	return (
		<div className={cn(state !== "none" ? "bg-positive/10" : "bg-surface")}>
			<div className="flex w-full items-start gap-3 px-3 py-2.5">
				<Checkbox
					className="mt-0.5"
					checked={state === "all"}
					indeterminate={state === "some"}
					onChange={() => onToggleGroup(group, state !== "all")}
					aria-label={`${state === "all" ? "Deselect" : "Select"} all ${count} ${plural(count)} from ${group.senderName}`}
				/>

				<Avatar name={group.senderName} email={group.senderAddress} size="sm" />

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-sm font-medium text-fg">
							{group.senderName}
						</span>
						{group.senderTrust && (
							<SenderTrustIndicator senderTrust={group.senderTrust} size="sm" />
						)}
						<span className="truncate text-2xs text-fg-subtle">
							{group.senderAddress}
						</span>
					</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
						<Badge tone="positive">
							<ShieldCheck className="size-3" aria-hidden />
							{group.trustReason}
						</Badge>
						<span className="text-2xs text-fg-subtle">
							{group.trustSubReason}
						</span>
					</div>
				</div>

				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					aria-expanded={expanded}
					className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
				>
					{`${count} ${plural(count)}`}
					<Chevron className="size-3.5" aria-hidden />
				</button>
			</div>

			{expanded && (
				<div className="divide-y divide-line border-t border-line">
					{group.messages.map((candidate) => (
						<RescueCandidateRow
							key={candidate.id}
							candidate={candidate}
							selected={selected.has(candidate.id)}
							onToggle={() => onToggleMessage(candidate.id)}
							hideSender
						/>
					))}
				</div>
			)}
		</div>
	);
}
