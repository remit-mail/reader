import { Button } from "@remit/ui";
import { Sparkles, X } from "lucide-react";

/**
 * Pane 4 of the 4-pane shell: the intelligence sidebar. Ships as an empty
 * shell here — its data wiring (sender identity, authenticity, category,
 * similar messages, LLM slots) is a separate issue (#425). What this
 * ticket (#422) delivers is the structural pane: a quiet labeled header on
 * the shared datum line and a collapsible body. The reference content lives
 * in remit-ui's `IntelligencePanel`; this stays intentionally minimal until
 * the data lands.
 */
export interface IntelligencePaneProps {
	onClose: () => void;
}

export const IntelligencePane = ({ onClose }: IntelligencePaneProps) => (
	// No left border: the ResizableHandle to our left already draws the 1px
	// hairline seam. Adding `border-l` here would double it to 2px, heavier
	// than every other pane boundary (the remit-ui AppShell reference passes
	// `border-l-0` to IntelligencePanel for exactly this reason).
	<aside className="flex h-full w-full flex-col bg-surface-sunken">
		<header className="flex h-pane-header shrink-0 items-center justify-between gap-2 border-b border-line px-row-inset">
			<span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
				<Sparkles className="size-3.5" />
				Intelligence
			</span>
			<Button
				variant="ghost"
				size="sm"
				icon={<X className="size-4" />}
				title="Hide intelligence sidebar"
				aria-label="Hide intelligence sidebar"
				onClick={onClose}
			/>
		</header>
		<div className="flex flex-1 flex-col items-center justify-center px-row-inset text-center">
			<Sparkles className="size-8 text-fg-subtle" />
			<p className="mt-3 text-sm text-fg-muted">Intelligence</p>
			<p className="mt-1 text-2xs text-fg-subtle">
				Sender trust, authenticity and similar messages will appear here.
			</p>
		</div>
	</aside>
);
