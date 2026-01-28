import type { RemitImapEnvelopeAddressResponse } from "@remit/api-http-client/types.gen.ts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

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
	const [expanded, setExpanded] = useState(false);

	if (addresses.length === 0) return null;

	const hasMany = addresses.length > 3;

	return (
		<div className="flex gap-2 text-sm">
			<span className="text-muted-foreground shrink-0 w-12">{label}:</span>
			<div className="flex-1 min-w-0">
				{expanded ? (
					<div className="flex flex-wrap gap-1">
						{addresses.map((addr, idx) => (
							<span key={idx}>
								<AddressDisplay address={addr} />
								{idx < addresses.length - 1 && ", "}
							</span>
						))}
					</div>
				) : (
					<div className="truncate">
						{addresses.map((addr, idx) => (
							<span key={idx}>
								<AddressDisplay address={addr} />
								{idx < addresses.length - 1 && ", "}
							</span>
						))}
					</div>
				)}
			</div>
			{hasMany && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						setExpanded(!expanded);
					}}
					className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
					aria-label={expanded ? "Collapse" : "Expand"}
				>
					{expanded ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
				</button>
			)}
		</div>
	);
};
