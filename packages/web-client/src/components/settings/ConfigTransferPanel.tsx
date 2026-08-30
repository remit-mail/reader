/**
 * The export card wired to the endpoint behind it.
 *
 * The download is minted in the browser from the export response rather than
 * linked, because the route is bearer-authenticated and a plain link carries no
 * token. `fetchQuery` rather than a mounted query: reading a whole
 * configuration is what pressing the button asks for, not what opening the
 * screen does.
 *
 * The read carries no `softError` meta on purpose. `GET /config/export` declares
 * no refusal, so its failures are a 5xx — which must reach the fatal page rather
 * than a card, and never be softened client-side — or a transport failure, which
 * does not escalate and is exactly what the card's failed state renders.
 */

import { configOperationsExportConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { exportFileName } from "@/lib/config-import";
import { useGoToSection } from "@/routing";
import { ConfigExportCard } from "./ConfigExportCard";

const saveJson = (fileName: string, body: unknown): void => {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
};

export function ConfigTransferPanel() {
	const queryClient = useQueryClient();
	const goToSection = useGoToSection();
	const [state, setState] = useState<"ready" | "downloading" | "failed">(
		"ready",
	);
	const [error, setError] = useState<string | undefined>(undefined);
	const fileName = exportFileName(new Date());

	const handleDownload = () => {
		if (state === "downloading") return;
		setState("downloading");
		setError(undefined);
		queryClient
			.fetchQuery(configOperationsExportConfigOptions())
			.then((response) => {
				saveJson(fileName, response.document);
				setState("ready");
			})
			.catch((cause: unknown) => {
				setState("failed");
				setError(
					cause instanceof Error
						? cause.message
						: "GET /config/export did not answer with a configuration.",
				);
			});
	};

	return (
		<ConfigExportCard
			fileName={fileName}
			state={state}
			error={error}
			onDownload={handleDownload}
			onImport={() => goToSection("importConfig")}
		/>
	);
}
