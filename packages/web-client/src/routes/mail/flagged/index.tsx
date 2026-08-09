import { createFileRoute } from "@tanstack/react-router";
import { FlaggedPane } from "@/components/mail/FlaggedPane";

function FlaggedReadingPane() {
	return <FlaggedPane.Reading />;
}

export const Route = createFileRoute("/mail/flagged/")({
	component: FlaggedReadingPane,
});
