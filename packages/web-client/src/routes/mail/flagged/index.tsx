import { createFileRoute } from "@tanstack/react-router";
import { FlaggedPane } from "@/components/mail/FlaggedPane";

export const Route = createFileRoute("/mail/flagged/")({
	component: FlaggedPane.Reading,
});
