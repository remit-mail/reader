import type { RemitImapMessageAuthenticity } from "@remit/api-http-client/types.gen.ts";
import { ShieldAlert } from "lucide-react";

/**
 * Danger banner rendered above the thread body when DKIM mismatch is detected.
 * Design spec (03-reading-and-intelligence.md): "a danger banner renders above
 * the body: 'This message claims to be a company but was sent from a personal
 * mailbox.' with a 'Why?' link that opens/highlights this section."
 *
 * The link sits in the sentence at the sentence's own size. Set apart as
 * smaller, right-floated chrome it read as a label rather than the way in.
 */
export function AuthenticityBanner({
	authenticity,
	onOpenIntelligence,
}: {
	authenticity: RemitImapMessageAuthenticity;
	onOpenIntelligence?: () => void;
}) {
	if (!authenticity.dkimMismatch) return null;

	return (
		<div className="flex items-start gap-2 rounded-none border-b border-danger/20 bg-danger-soft px-5 py-2.5 text-sm">
			<ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" />
			<p className="flex-1 leading-snug text-fg">
				This message claims to be from{" "}
				<span className="font-semibold">{authenticity.fromDomain}</span> but was
				sent
				{authenticity.dkimDomain
					? ` via ${authenticity.dkimDomain}`
					: " from a different domain"}
				.{" "}
				{onOpenIntelligence && (
					<button
						type="button"
						onClick={onOpenIntelligence}
						className="font-medium text-danger hover:underline"
					>
						Why?
					</button>
				)}
			</p>
		</div>
	);
}
