import { Button, FieldLabel, Input, ServerFields, SlidePanel } from "@remit/ui";
import { AtSign } from "lucide-react";

/**
 * Account settings edit form (RFC 021). Reached from Settings → Accounts →
 * Manage; the app mounts it in the shared `SlidePanel` slide-over, kept mounted
 * and driven by `isOpen`, so a story can hold the closed state — the state that
 * broke in #57, where a closed panel covered the whole screen.
 */
export interface EditAccountFormProps {
	email: string;
	displayName?: string;
	isOpen?: boolean;
	onCancel?: () => void;
	onSave?: () => void;
}

export function EditAccountForm({
	email,
	displayName = "",
	isOpen = true,
	onCancel,
	onSave,
}: EditAccountFormProps) {
	return (
		<SlidePanel
			isOpen={isOpen}
			onClose={onCancel ?? (() => {})}
			title="Edit account"
			footer={
				<>
					<Button variant="secondary" size="sm" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="primary" size="sm" onClick={onSave}>
						Save
					</Button>
				</>
			}
		>
			<div className="space-y-5">
				<div className="space-y-4">
					<div>
						<FieldLabel htmlFor="edit-account-email">Email address</FieldLabel>
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
		</SlidePanel>
	);
}
