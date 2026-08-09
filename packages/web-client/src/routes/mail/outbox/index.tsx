import { createFileRoute } from "@tanstack/react-router";
import { OutboxPane } from "@/components/mail/OutboxPane";

function OutboxReadingPane() {
	return <OutboxPane.Reading />;
}

export const Route = createFileRoute("/mail/outbox/")({
	component: OutboxReadingPane,
});
