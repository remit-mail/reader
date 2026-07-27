/**
 * Settings > Advanced, shown only for TLS_MODE=internal (deploy/vps/README.md,
 * "TLS", has the rationale). Downloads the same root CA `remit cert` exports,
 * served by deploy/vps/caddy/internal.caddy — reachable in-app instead of
 * over SSH.
 */
import { ButtonLink } from "@remit/ui";
import { ShieldCheck } from "lucide-react";
import { getRuntimeConfig } from "@/runtime-config";

export function TlsRootCaDownload() {
	if (getRuntimeConfig().tlsMode !== "internal") return null;

	return (
		<div className="border-t border-line pt-4 mt-4">
			<p className="text-sm font-medium text-fg mb-1">TLS root certificate</p>
			<p className="text-sm text-fg-muted mb-2">
				This deployment signs its own certificate. Import it into the trust
				store of each device you browse from, and the browser warning stops for
				good.
			</p>
			<ButtonLink
				href="/tls-root-ca.crt"
				download
				variant="secondary"
				size="sm"
				icon={<ShieldCheck className="size-3.5" />}
			>
				Download root certificate
			</ButtonLink>
		</div>
	);
}
