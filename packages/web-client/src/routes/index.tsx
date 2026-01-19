import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	const { t } = useTranslation();

	return (
		<div className="flex flex-col items-center justify-center h-full p-8">
			<h1 className="text-3xl font-bold mb-4">{t("app.title")}</h1>
			<p className="text-muted-foreground">Welcome to Remit</p>
		</div>
	);
}
