import {
	Button,
	Dialog,
	FieldLabel,
	Input,
	ServerFields,
} from "@remit/ui";
import { AtSign, X } from "lucide-react";

/**
 * Account settings edit form (RFC 021). Reached from Settings → Accounts →
 * Manage; renders as the slide-in panel from the mockup. Email address is
 * fixed for an existing account; Display Name is the editable, optional label
 * (blank falls back to a derived name).
 */
export interface EditAccountFormProps {
	email: string;
	displayName?: string;
	onCancel?: () => void;
	onSave?: () => void;
}

export function EditAccountForm({
	email,
	displayName = "",
	onCancel,
	onSave,
}: EditAccountFormProps) {
	return (
		<Dialog
			open
			onClose={onCancel ?? (() => {})}
			title="Edit account"
			anchor="right"
		>
			<div className="flex h-full flex-col">
				<header className="flex items-center gap-2 border-b border-line px-5 py-3">
					<span className="flex-1 text-sm font-semibold text-fg">
						Edit account
					</span>
					<Button
						variant="ghost"
						size="sm"
						icon={<X className="size-3.5" />}
						onClick={onCancel}
						aria-label="Close"
					/>
				</header>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
					<div className="space-y-4">
						<div>
							<FieldLabel htmlFor="edit-account-email">
								Email address
							</FieldLabel>
							<Input
								id="edit-account-email"
								icon={<AtSign className="size-4" />}
								defaultValue={email}
								readOnly
							/>
						</div>
						<div>
							<FieldLabel htmlFor="edit-account-display-name">
								Display name (optional)
							</FieldLabel>
							<Input
								id="edit-account-display-name"
								defaultValue={displayName}
								placeholder="Alice"
							/>
							<p className="mt-1.5 text-2xs text-fg-subtle">
								What to call this account in Remit. Leave blank to use a name
								derived from the address.
							</p>
						</div>
					</div>

					<ServerFields
						legend="IMAP — incoming"
						host="imap.example.com"
						port="993"
						security="tls"
						hostPlaceholder="imap.example.com"
						portPlaceholder="993"
					/>
					<ServerFields
						legend="SMTP — outgoing"
						host="smtp.example.com"
						port="587"
						security="starttls"
						hostPlaceholder="smtp.example.com"
						portPlaceholder="587"
					/>
				</div>

				<footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
					<Button variant="secondary" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="primary" size="sm" onClick={onSave}>
						Save
					</Button>
				</footer>
			</div>
		</Dialog>
	);
}
