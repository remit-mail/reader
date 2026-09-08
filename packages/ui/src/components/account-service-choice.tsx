import { useId } from "react";
import { Banner } from "./banner.js";
import { Checkbox } from "./checkbox.js";

/** One service an account syncs. Mirrors the set the account endpoints take. */
export type AccountServiceId = "Mail" | "Calendar";

/** Refusal for the empty set: no stored account ever syncs nothing. */
export const ACCOUNT_SERVICE_EMPTY_MESSAGE =
	"Pick at least one. An account has to sync something.";

interface ServiceRow {
	id: AccountServiceId;
	label: string;
	description: string;
}

const SERVICE_ROWS: ServiceRow[] = [
	{
		id: "Mail",
		label: "Mail",
		description: "Messages, folders and sending.",
	},
	{
		id: "Calendar",
		label: "Calendar",
		description: "This account's provider calendar, read into Remit.",
	},
];

export interface AccountServiceChoiceProps {
	/** Provider named in the re-consent line, e.g. "Microsoft". */
	providerName: string;
	/** Services this provider syncs. Under two of them the choice is absent. */
	offered: AccountServiceId[];
	selected: AccountServiceId[];
	onChange: (next: AccountServiceId[]) => void;
	/** Refusal shown under the rows, e.g. ACCOUNT_SERVICE_EMPTY_MESSAGE. */
	error?: string;
	legend?: string;
	className?: string;
}

export function AccountServiceChoice({
	providerName,
	offered,
	selected,
	onChange,
	error,
	legend = "What should Remit sync?",
	className,
}: AccountServiceChoiceProps) {
	const noteId = useId();
	const rows = SERVICE_ROWS.filter((row) => offered.includes(row.id));

	if (rows.length < 2) return null;

	const toggle = (id: AccountServiceId, checked: boolean) => {
		if (!checked) {
			onChange(selected.filter((service) => service !== id));
			return;
		}
		onChange(
			SERVICE_ROWS.filter(
				(row) => row.id === id || selected.includes(row.id),
			).map((row) => row.id),
		);
	};

	return (
		<fieldset className={className} aria-describedby={noteId}>
			<legend className="text-sm font-semibold text-fg">{legend}</legend>
			<div className="mt-1 divide-y divide-line">
				{rows.map((row) => (
					<Checkbox
						key={row.id}
						label={row.label}
						description={row.description}
						checked={selected.includes(row.id)}
						onChange={(event) => toggle(row.id, event.target.checked)}
					/>
				))}
			</div>
			<p id={noteId} className="mt-1.5 text-2xs text-fg-subtle">
				{`Changing this later means signing in with ${providerName} again.`}
			</p>
			{error && (
				<Banner tone="danger" variant="soft" className="mt-2 text-xs">
					{error}
				</Banner>
			)}
		</fieldset>
	);
}
