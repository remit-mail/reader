import { AttentionDot } from "@remit/ui";
import { TriangleAlert } from "lucide-react";
import { useWarningsAttention } from "@/hooks/useWarningsAttention";

export function WarningsNavIcon() {
	const attention = useWarningsAttention();
	return (
		<AttentionDot label={attention}>
			<TriangleAlert className="size-4" />
		</AttentionDot>
	);
}
