import {
	isLabelColorValue,
	labelDotClass,
	PopoverMenu,
	type PopoverMenuItem,
} from "@remit/ui";
import { Tag } from "lucide-react";
import { useMemo } from "react";
import { useApplyLabel } from "@/hooks/useApplyLabel";
import { useLabelList } from "@/hooks/useLabels";

interface LabelApplyTriggerProps {
	accountId: string;
	mailboxId: string;
	messageIds: string[];
}

/**
 * "Apply label" for a selection — the manual "just these" scope (issue #26,
 * RFC 034 recap). A worded row at the foot of the selection bar's overflow
 * menu, opening the account's labels; picking one applies it to every selected
 * message. Renders nothing when the account has no labels yet — an empty menu
 * offering only "create one in Settings" is dead weight; Settings › Labels is
 * where creation lives.
 */
export function LabelApplyTrigger({
	accountId,
	mailboxId,
	messageIds,
}: LabelApplyTriggerProps) {
	const { labels } = useLabelList(accountId);
	const { applyLabel } = useApplyLabel({ accountId, mailboxId });

	const items = useMemo<PopoverMenuItem[]>(
		() =>
			labels.map((label) => ({
				key: label.labelId,
				label: label.name,
				icon: (
					<span
						className={`size-2.5 rounded-full ${
							isLabelColorValue(label.color)
								? labelDotClass[label.color]
								: labelDotClass.Default
						}`}
					/>
				),
				onSelect: () => applyLabel(messageIds, label.labelId, "Apply"),
			})),
		[labels, messageIds, applyLabel],
	);

	if (items.length === 0) return null;

	return (
		<PopoverMenu
			triggerLabel="Apply label to selected messages"
			triggerIcon={<Tag className="size-4 text-fg-subtle" />}
			triggerText="Apply label"
			items={items}
			align="start"
			nested
			touch={false}
			triggerClassName="min-h-11 w-full justify-start gap-3 px-4 py-2.5 text-sm font-normal text-fg"
		/>
	);
}
