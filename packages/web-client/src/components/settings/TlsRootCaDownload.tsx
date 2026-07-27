/**
 * Settings > Advanced: only when this deployment terminates TLS with Caddy's
 * own locally-trusted CA (TLS_MODE=internal). That CA's leaf certificate is
 * reissued every 12 hours, so a browser click-through exception (pinned to
 * the leaf) breaks twice a day — the fix is trusting the root once per
 * device. This downloads the same file `remit cert` copies out of the caddy
 * container (deploy/vps/caddy/internal.caddy serves it), just reachable
 * in-app instead of over SSH.
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
