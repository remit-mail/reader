import type {
	ILabelRepository,
	IMessageLabelRepository,
} from "@remit/data-ports";
import type { SpamKind } from "@remit/domain-enums";

type Kind = (typeof SpamKind)[keyof typeof SpamKind];

export interface SpamLabelDeps {
	label: Pick<ILabelRepository, "findByNormalizedName">;
	messageLabel: Pick<IMessageLabelRepository, "listByMessageId" | "remove">;
}

/**
 * Takes the labels of `kinds` off a message, except those named in `keep`.
 * Labels are Remit-local, never pushed to the mail server, so dropping one is
 * a plain row delete rather than an IMAP mutation.
 */
export const removeSpamLabels = async (
	deps: SpamLabelDeps,
	accountConfigId: string,
	messageId: string,
	kinds: readonly Kind[],
	keep: readonly string[],
): Promise<void> => {
	const applied = new Set(
		(await deps.messageLabel.listByMessageId(messageId)).map(
			(row) => row.labelId,
		),
	);
	for (const kind of kinds) {
		if (keep.includes(kind)) continue;
		const label = await deps.label.findByNormalizedName(
			accountConfigId,
			kind.toLowerCase(),
		);
		if (label && applied.has(label.labelId)) {
			await deps.messageLabel.remove(messageId, label.labelId);
		}
	}
};
