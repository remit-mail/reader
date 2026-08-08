import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import type { RecurrenceScope } from "./calendar-types.js";

export interface RecurrenceScopePromptProps {
	/** The series being edited, e.g. "Standup". */
	title: string;
	/** The rule in words, e.g. "Every weekday, 09:15". */
	ruleText: string;
	/** The instance that was clicked, already formatted. */
	instanceText: string;
	onChoose: (scope: RecurrenceScope) => void;
	onCancel: () => void;
	touch?: boolean;
	className?: string;
}

const choices: { scope: RecurrenceScope; label: string; note: string }[] = [
	{
		scope: "this",
		label: "This event",
		note: "Leaves the rest of the series alone",
	},
	{
		scope: "following",
		label: "This and everything after",
		note: "Splits the series here",
	},
	{ scope: "all", label: "The whole series", note: "Rewrites the rule itself" },
];

/**
 * The scope question, asked first. A series is one object with one rule, and
 * which instances an edit reaches changes what the edit means — so it is
 * settled before the form opens, not confirmed on the way out when the change
 * has already been typed.
 */
export function RecurrenceScopePrompt({
	title,
	ruleText,
	instanceText,
	onChoose,
	onCancel,
	touch,
	className,
}: RecurrenceScopePromptProps) {
	return (
		<div className={cn("flex flex-col gap-3", className)}>
			<div>
				<h2 className="text-md font-semibold text-fg">{title} repeats</h2>
				<p className="text-xs text-fg-muted">{ruleText}</p>
				<p className="text-xs text-fg-subtle">You clicked {instanceText}.</p>
			</div>

			<p className="text-sm text-fg">What should the change apply to?</p>

			<div className="flex flex-col gap-1.5">
				{choices.map((choice) => (
					<button
						key={choice.scope}
						type="button"
						onClick={() => onChoose(choice.scope)}
						className={cn(
							"flex flex-col rounded-md border border-line bg-surface px-3 py-2 text-left outline-none transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-ring",
							touch && "min-h-11 justify-center",
						)}
					>
						<span className="text-sm font-medium text-fg">{choice.label}</span>
						<span className="text-2xs text-fg-subtle">{choice.note}</span>
					</button>
				))}
			</div>

			<Button
				variant="ghost"
				size={touch ? "md" : "sm"}
				onClick={onCancel}
				className={cn("self-start", touch && "min-h-11")}
			>
				Cancel
			</Button>
		</div>
	);
}
