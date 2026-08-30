import { type CalendarParseMethod, calendarParseNote, cn } from "@remit/ui";

/**
 * The reading, opened up: the note for the rung that answered, the exact field
 * or words it rests on, and each value with the source that produced it. The
 * badge that names the rung lives in the kit — every surface that shows a
 * reading shows the same one.
 */

export function ParseProvenance({
	method,
	evidence,
	fields,
	className,
}: {
	method: CalendarParseMethod;
	evidence: string;
	fields?: { label: string; value: string; source: string }[];
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<p className="text-2xs text-fg-muted">{calendarParseNote[method]}</p>
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
