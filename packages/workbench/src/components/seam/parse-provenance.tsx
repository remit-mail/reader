import { cn } from "@remit/ui";
import { Code2, FileText, TextSearch } from "lucide-react";
import {
	type ParseMethod,
	parseMethodLabel,
	parseMethodNote,
} from "../../fixtures/calendar-mail.js";

/**
 * Which rung of the ladder answered. Deterministic readings run first — an
 * attached invitation, then machine-readable markup — and only what neither
 * settles is left to a pattern in the prose. Saying which one fired is not
 * trivia: it is the difference between a fact the sender stated and a guess the
 * reader made, and the reader is the one who has to decide how hard to check.
 */

const icons: Record<ParseMethod, typeof FileText> = {
	ics: FileText,
	markup: Code2,
	pattern: TextSearch,
};

const tones: Record<ParseMethod, string> = {
	ics: "border-positive/50 text-positive",
	markup: "border-accent-2/50 text-accent-2",
	pattern: "border-warning/50 text-warning",
};

export function ParseBadge({
	method,
	className,
}: {
	method: ParseMethod;
	className?: string;
}) {
	const Icon = icons[method];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium",
				tones[method],
				className,
			)}
		>
			<Icon className="size-3" aria-hidden />
			{parseMethodLabel[method]}
		</span>
	);
}

export function ParseProvenance({
	method,
	evidence,
	fields,
	className,
}: {
	method: ParseMethod;
	evidence: string;
	fields?: { label: string; value: string; source: string }[];
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<p className="text-2xs text-fg-muted">{parseMethodNote[method]}</p>
			<p className="truncate rounded-sm bg-surface-sunken px-2 py-1 font-mono text-2xs text-fg-subtle">
				{evidence}
			</p>
			{fields && fields.length > 0 && (
				<dl className="flex flex-col gap-1">
					{fields.map((field) => (
						<div key={field.label} className="flex items-baseline gap-2">
							<dt className="w-16 shrink-0 text-2xs uppercase tracking-wider text-fg-subtle">
								{field.label}
							</dt>
							<dd className="min-w-0 flex-1 text-xs text-fg">
								{field.value}
								<span className="ml-1.5 text-2xs text-fg-subtle">
									from {field.source}
								</span>
							</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}
