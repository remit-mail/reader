import type { RemitImapEnvelopeAddressResponse } from "@remit/api-http-client/types.gen.ts";
import { BadgeCheck, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

interface AddressDisplayProps {
	address: RemitImapEnvelopeAddressResponse;
	/**
	 * When true, render a small "trusted sender" checkmark next to the
	 * address. Driven by `address.flags?.trusted?.value === true` upstream
	 * so the check is centralized in the parent that knows the role
	 * (e.g. only From-addresses get the indicator).
	 */
	showTrustedBadge?: boolean;
}

export const AddressDisplay = ({
	address,
	showTrustedBadge = false,
}: AddressDisplayProps) => {
	const badge = showTrustedBadge ? (
		<BadgeCheck
			className="inline-block size-4 ml-1 -mt-0.5 text-green-600 dark:text-green-500"
			aria-label="Trusted sender"
			data-testid="trusted-sender-badge"
		/>
	) : null;

	if (address.displayName) {
		return (
			<span>
				<span className="text-fg">{address.displayName}</span>
				<span className="text-fg-muted">
					{" "}
					&lt;{address.normalizedEmail}&gt;
				</span>
				{badge}
			</span>
		);
	}
	return (
		<span className="text-fg">
			{address.normalizedEmail}
			{badge}
		</span>
	);
};

interface AddressListProps {
	label: string;
	addresses: RemitImapEnvelopeAddressResponse[];
	/**
	 * When true, addresses with `flags.trusted.value === true` render a
	 * green checkmark. Only set this for the From row; trusted-status of
	 * To/Cc senders is irrelevant to the current viewer.
	 */
	showTrustedBadge?: boolean;
}

export const AddressList = ({
	label,
	addresses,
	showTrustedBadge = false,
}: AddressListProps) => {
	const [expanded, setExpanded] = useState(false);

	if (addresses.length === 0) return null;

	const hasMany = addresses.length > 3;

	const renderAddress = (addr: RemitImapEnvelopeAddressResponse) => {
		const isTrusted = showTrustedBadge && addr.flags?.trusted?.value === true;
		return <AddressDisplay address={addr} showTrustedBadge={isTrusted} />;
	};

	return (
		<div className="flex gap-2 text-sm">
			<span className="text-fg-muted shrink-0 w-12">{label}:</span>
			<div className="flex-1 min-w-0">
				{expanded ? (
					<div className="flex flex-wrap gap-1">
						{addresses.map((addr, idx) => (
							<span key={idx}>
								{renderAddress(addr)}
								{idx < addresses.length - 1 && ", "}
							</span>
						))}
					</div>
				) : (
					<div className="truncate">
						{addresses.map((addr, idx) => (
							<span key={idx}>
								{renderAddress(addr)}
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
					className="shrink-0 text-fg-muted hover:text-fg transition-colors"
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
