import type { RemitImapEnvelopeAddressResponse } from "@remit/api-http-client/types.gen.ts";

interface AddressDisplayProps {
	address: RemitImapEnvelopeAddressResponse;
}

export const AddressDisplay = ({ address }: AddressDisplayProps) => {
	if (address.displayName) {
		return (
			<span>
				<span className="text-foreground">{address.displayName}</span>
				<span className="text-muted-foreground">
					{" "}
					&lt;{address.normalizedEmail}&gt;
				</span>
			</span>
		);
	}
	return <span className="text-foreground">{address.normalizedEmail}</span>;
};

interface AddressListProps {
	label: string;
	addresses: RemitImapEnvelopeAddressResponse[];
}

export const AddressList = ({ label, addresses }: AddressListProps) => {
	if (addresses.length === 0) return null;

	return (
		<div className="flex gap-2 text-sm">
			<span className="text-muted-foreground shrink-0 w-12">{label}:</span>
			<div className="flex flex-wrap gap-1">
				{addresses.map((addr, idx) => (
					<span key={idx}>
						<AddressDisplay address={addr} />
						{idx < addresses.length - 1 && ", "}
					</span>
				))}
			</div>
		</div>
	);
};
