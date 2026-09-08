import { useId } from "react";
import { Banner } from "./banner.js";
import { Checkbox } from "./checkbox.js";

/** One service an account syncs. Mirrors the set the account endpoints take. */
export type AccountService = "Mail" | "Calendar";

/** Refusal for the empty set: no stored account ever syncs nothing. */
export const ACCOUNT_SERVICE_EMPTY_MESSAGE =
	"Pick at least one. An account has to sync something.";

interface ServiceRow {
	id: AccountService;
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
	/** Services this provider syncs. Under two of them the rows are absent. */
	offered: AccountService[];
	selected: AccountService[];
	onChange: (next: AccountService[]) => void;
	/** Refusal shown under the rows, e.g. ACCOUNT_SERVICE_EMPTY_MESSAGE. */
	error?: string;
}

export function AccountServiceChoice({
	providerName,
	offered,
	selected,
	onChange,
	error,
}: AccountServiceChoiceProps) {
	const noteId = useId();
	const rows = SERVICE_ROWS.filter((row) => offered.includes(row.id));

	const refusal = error ? (
		<Banner tone="danger" variant="soft" className="mt-2 text-xs">
			{error}
		</Banner>
	) : null;

	// A single-service provider has nothing to choose, but its host can still
	// refuse an empty set, and that refusal has to land somewhere.
	if (rows.length < 2) return refusal;

	const toggle = (id: AccountService, checked: boolean) => {
		if (!checked) {
			onChange(selected.filter((service) => service !== id));
			return;
		}
		onChange(
			rows
				.filter((row) => row.id === id || selected.includes(row.id))
				.map((row) => row.id),
		);
	};

	return (
		<fieldset aria-describedby={noteId}>
			<legend className="text-sm font-semibold text-fg">
				What should Remit sync?
			</legend>
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
				{`Adding a service later means signing in with ${providerName} again.`}
			</p>
			{refusal}
		</fieldset>
	);
}
