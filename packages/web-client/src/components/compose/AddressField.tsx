import { addressOperationsSearchAddressesOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import {
	type AddressEntry,
	ComposeAddressField,
	type ComposeAddressFieldHandle,
} from "@remit/ui";
import { useQuery } from "@tanstack/react-query";
import { type Ref, useMemo, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { offerableAsRecipient } from "@/lib/recipient-suggestions";

export type { AddressEntry, ComposeAddressFieldHandle };

interface AddressFieldProps {
	label: string;
	addresses: AddressEntry[];
	onChange: (addresses: AddressEntry[]) => void;
	placeholder?: string;
	ref?: Ref<ComposeAddressFieldHandle>;
}

/** Looks the account's known correspondents up for the field to offer. */
export const AddressField = ({
	label,
	addresses,
	onChange,
	placeholder,
	ref,
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
			(data?.items ?? []).filter(offerableAsRecipient).map((item) => ({
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
			ref={ref}
		/>
	);
};
