import { createFileRoute } from "@tanstack/react-router";
import { OutboxPane } from "@/components/mail/OutboxPane";

export const Route = createFileRoute("/mail/outbox/")({
	component: OutboxPane.Reading,
});
