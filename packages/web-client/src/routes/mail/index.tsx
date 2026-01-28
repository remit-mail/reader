import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/ui/EmptyState";

export const Route = createFileRoute("/mail/")({
	component: MailIndex,
});

function MailIndex() {
	return (
		<div className="flex flex-1 items-center justify-center bg-background">
			<EmptyState message="Select a mailbox to view messages" />
		</div>
	);
}
