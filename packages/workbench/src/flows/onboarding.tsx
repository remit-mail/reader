import {
	ACCOUNT_SERVICE_EMPTY_MESSAGE,
	type AccountService,
	AccountServiceChoice,
	Button,
	ConnectorTile,
	FieldLabel,
	Input,
	WizardShell,
} from "@remit/ui";
import { AtSign, Inbox } from "lucide-react";
import { useState } from "react";

const steps = [
	"Connector",
	"Address",
	"Servers",
	"Credentials",
	"Test",
	"Sync",
];

interface StepNav {
	onBack?: () => void;
	onNext?: () => void;
}

const BOTH_SERVICES: AccountService[] = ["Mail", "Calendar"];

export interface StepMicrosoftEmailProps extends StepNav {
	/** Services the chosen connector carries. Under two, no rows appear. */
	offered?: AccountService[];
	initialServices?: AccountService[];
}

export function StepMicrosoftEmail({
	offered = BOTH_SERVICES,
	initialServices,
	onBack,
	onNext,
}: StepMicrosoftEmailProps) {
	const [selected, setSelected] = useState(initialServices ?? offered);
	const [refused, setRefused] = useState(false);
	const empty = selected.length === 0;

	const handleContinue = () => {
		if (empty) {
			setRefused(true);
			return;
		}
		onNext?.();
	};

	return (
		<WizardShell
			steps={steps}
			activeStep={0}
			title="Sign in with Microsoft"
			subtitle="Microsoft is asked for the mail and calendar access you pick here."
			footer={
				<>
					<Button variant="ghost" onClick={onBack}>
						Back
					</Button>
					<Button variant="primary" onClick={handleContinue}>
						Sign in with Microsoft
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<ConnectorTile
						name="Outlook / Microsoft 365"
						description="Sign in with Microsoft. Works with Outlook.com and work accounts."
						icon={<Inbox className="size-5" />}
						selected
						onSelect={() => {}}
					/>
				</div>
				<AccountServiceChoice
					providerName="Microsoft"
					offered={offered}
					selected={selected}
					onChange={setSelected}
					error={refused && empty ? ACCOUNT_SERVICE_EMPTY_MESSAGE : undefined}
				/>
				<div>
					<FieldLabel htmlFor="ms-email">Email address (optional)</FieldLabel>
					<Input
						id="ms-email"
						icon={<AtSign className="size-4" />}
						placeholder="you@outlook.com"
					/>
					<p className="mt-1.5 text-2xs text-fg-subtle">
						Pre-fills the Microsoft sign-in form. Leave blank to choose on the
						Microsoft page.
					</p>
				</div>
			</div>
		</WizardShell>
	);
}
