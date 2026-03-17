import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useQuery } from "@tanstack/react-query";

interface FromSelectorProps {
	selectedAccountId?: string;
	onSelect: (account: RemitImapAccountResponse) => void;
}

export const FromSelector = ({
	selectedAccountId,
	onSelect,
}: FromSelectorProps) => {
	const { data: config } = useQuery(configOperationsGetConfigOptions());
	const accounts = config?.accounts ?? [];

	if (accounts.length <= 1) {
		const account = accounts[0];
		if (!account) return null;
		return (
			<div className="flex items-start gap-2">
				<label className="text-sm text-muted-foreground shrink-0 w-12 pt-1.5">
					From:
				</label>
				<div className="text-sm py-1.5">{account.email}</div>
			</div>
		);
	}

	return (
		<div className="flex items-start gap-2">
			<label className="text-sm text-muted-foreground shrink-0 w-12 pt-1.5">
				From:
			</label>
			<select
				value={selectedAccountId ?? ""}
				onChange={(e) => {
					const account = accounts.find((a) => a.accountId === e.target.value);
					if (account) onSelect(account);
				}}
				className="flex-1 px-2 py-1.5 border rounded-md bg-background text-sm"
			>
				{accounts.map((account) => (
					<option key={account.accountId} value={account.accountId}>
						{account.email}
					</option>
				))}
			</select>
		</div>
	);
};
