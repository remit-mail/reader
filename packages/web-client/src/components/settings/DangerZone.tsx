import { Button, DangerZoneSection } from "@remit/ui";
import { useState } from "react";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

export function DangerZone() {
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<section className="mt-8 border-t border-line pt-6">
			<DangerZoneSection
				title="Delete your Remit account"
				description="Disconnects every account and erases Remit's copy of your mail, insights and preferences. Your mail at the providers is untouched."
				action={
					<Button
						variant="danger"
						size="sm"
						onClick={() => setDialogOpen(true)}
					>
						Delete your Remit account
					</Button>
				}
			/>

			<DeleteAccountDialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
			/>
		</section>
	);
}
