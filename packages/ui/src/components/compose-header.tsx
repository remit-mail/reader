import type { ReactNode } from "react";
import type { AddressEntry } from "./compose-address-field.js";

export interface ComposeHeaderProps {
	/**
	 * The software keyboard is up on a phone and the recipient rows would eat
	 * the writing surface. The header collapses to one line of what is already
	 * filled in.
	 */
	collapsed?: boolean;
	/** One line of what the collapsed header stands in for. */
	summary?: string;
	from: ReactNode;
	to: ReactNode;
	/** Present once the field has been revealed; absent leaves the reveal button. */
	cc?: ReactNode;
	bcc?: ReactNode;
	subject: ReactNode;
	onShowCc: () => void;
	onShowBcc: () => void;
}

const RevealButton = ({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) => (
	<button
		type="button"
		onClick={onClick}
		className="text-xs text-fg-muted hover:text-fg transition-colors"
	>
		{label}
	</button>
);

export const composeHeaderSummary = ({
	to,
	cc,
	bcc,
	subject,
}: {
	to: readonly AddressEntry[];
	cc: readonly AddressEntry[];
	bcc: readonly AddressEntry[];
	subject: string;
}): string => {
	const chips: string[] = [];
	if (to.length > 0)
		chips.push(`To: ${to.map((a) => a.displayName ?? a.email).join(", ")}`);
	if (cc.length > 0) chips.push(`Cc: ${cc.length}`);
	if (bcc.length > 0) chips.push(`Bcc: ${bcc.length}`);
	if (subject) chips.push(subject);
	return chips.join(" · ");
};

/**
 * Who the message is going to and what it is about. The fields are slots: the
 * app fills them with the wired address and account controls, a story with
 * static ones, and both get the same layout, the same Cc/Bcc reveal and the
 * same collapsed line.
 */
export const ComposeHeader = ({
	collapsed = false,
	summary = "",
	from,
	to,
	cc,
	bcc,
	subject,
	onShowCc,
	onShowBcc,
}: ComposeHeaderProps) => {
	if (collapsed) {
		return (
			<div
				className="flex items-center gap-2 px-3 py-1.5 border-b border-line overflow-hidden"
				data-testid="compose-header-collapsed"
			>
				<span className="truncate text-xs text-fg-muted">{summary || "…"}</span>
				<span className="shrink-0 inline-flex items-center justify-center rounded bg-surface-sunken px-1.5 py-0.5 text-2xs text-fg-muted">
					…
				</span>
			</div>
		);
	}

	return (
		<div className="space-y-1 px-3 py-2 border-b border-line">
			{from}
			{to}
			{cc ?? (
				<div className="flex gap-2 pl-14">
					<RevealButton label="Cc" onClick={onShowCc} />
					<RevealButton label="Bcc" onClick={onShowBcc} />
				</div>
			)}
			{cc && !bcc && (
				<div className="pl-14">
					<RevealButton label="Bcc" onClick={onShowBcc} />
				</div>
			)}
			{bcc}
			{subject}
		</div>
	);
};
