import { addressOperationsSearchAddressesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { type AddressEntry, ComposeAddressField } from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { offerableAsRecipient } from "@/lib/recipient-suggestions";

export type { AddressEntry };

interface AddressFieldProps {
	label: string;
	addresses: AddressEntry[];
	onChange: (addresses: AddressEntry[]) => void;
	placeholder?: string;
}

/** Looks the account's known correspondents up for the field to offer. */
export const AddressField = ({
	label,
	addresses,
	onChange,
	placeholder,
}: AddressFieldProps) => {
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebouncedValue(query, 200);

	const { data } = useQuery({
		...addressOperationsSearchAddressesOptions({
			query: { q: debouncedQuery, limit: 8 },
		}),
		enabled: debouncedQuery.length >= 2,
	});

	const suggestions = useMemo<AddressEntry[]>(
		() =>
			(data?.items ?? [])
				.filter((item) => offerableAsRecipient(item.flags))
				.map((item) => ({
					email: item.normalizedEmail,
					displayName: item.displayName,
				})),
		[data],
	);

	return (
		<ComposeAddressField
			label={label}
			addresses={addresses}
			onChange={onChange}
			placeholder={placeholder}
			suggestions={suggestions}
			onQueryChange={setQuery}
		/>
	);
};
