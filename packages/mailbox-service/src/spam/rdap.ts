import type {
	DomainRegistrationItem,
	IDomainRegistrationRepository,
} from "@remit/data-ports";
import { NotFoundError } from "@remit/data-ports/errors";

type Registration = DomainRegistrationItem["registration"];

export type RdapFetch = (
	url: string,
	init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface RdapLogger {
	info(obj: Record<string, unknown>, msg: string): void;
}

const IANA_DNS_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const TIMEOUT_MS = 5_000;

type Bootstrap = { services: [string[], string[]][] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === "string");

const isBootstrap = (value: unknown): value is Bootstrap =>
	isRecord(value) &&
	Array.isArray(value.services) &&
	value.services.every(
		(service) =>
			Array.isArray(service) &&
			isStringArray(service[0]) &&
			isStringArray(service[1]),
	);

const registrationDate = (events: unknown): string | undefined => {
	if (!Array.isArray(events)) return undefined;
	const event = events.find(
		(candidate) =>
			isRecord(candidate) && candidate.eventAction === "registration",
	);
	if (!isRecord(event) || typeof event.eventDate !== "string") return undefined;
	return Number.isNaN(Date.parse(event.eventDate))
		? undefined
		: event.eventDate;
};

/**
 * What an RDAP domain answer says about registration. A registry that answers
 * without a `registration` event, as DENIC does for .de, published no date.
 * Anything that is not an RDAP domain object is no answer at all.
 */
export const parseRdapRegistration = (
	body: unknown,
): Registration | undefined => {
	if (!isRecord(body) || body.objectClassName !== "domain") return undefined;
	const registeredAt = registrationDate(body.events);
	return registeredAt === undefined
		? { state: "Unpublished" }
		: { state: "Published", registeredAt };
};

const getJson = async (fetch: RdapFetch, url: string): Promise<unknown> => {
	const response = await fetch(url, {
		headers: { accept: "application/rdap+json, application/json" },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`RDAP ${url} answered with an error`);
	return response.json();
};

/**
 * Asks the registry that serves a domain's TLD, found through the IANA
 * bootstrap file. The bootstrap is read once per client.
 */
export class RdapClient {
	private bootstrap?: Promise<Bootstrap>;

	constructor(private readonly fetch: RdapFetch) {}

	private servers(): Promise<Bootstrap> {
		if (this.bootstrap) return this.bootstrap;
		const loading = getJson(this.fetch, IANA_DNS_BOOTSTRAP).then((body) => {
			if (!isBootstrap(body)) throw new Error("RDAP bootstrap is unreadable");
			return body;
		});
		this.bootstrap = loading;
		loading.catch(() => {
			if (this.bootstrap === loading) this.bootstrap = undefined;
		});
		return loading;
	}

	async lookup(registrableDomain: string): Promise<Registration | undefined> {
		const tld = registrableDomain.split(".").at(-1) ?? "";
		const { services } = await this.servers();
		const base = services.find(([tlds]) => tlds.includes(tld))?.[1][0];
		if (base === undefined) return undefined;
		const url = new URL(
			`domain/${registrableDomain}`,
			base.endsWith("/") ? base : `${base}/`,
		);
		return parseRdapRegistration(await getJson(this.fetch, url.toString()));
	}
}

export interface DomainRegistrationDeps {
	domainRegistration: IDomainRegistrationRepository;
	rdap: Pick<RdapClient, "lookup">;
	logger: RdapLogger;
}

/**
 * The domain's registration date, from the cache or a fresh RDAP answer. Only
 * an answer is cached, an answer without a date included. A failed lookup
 * leaves the date absent and is asked again next time.
 */
export const domainRegisteredAt = async (
	deps: DomainRegistrationDeps,
	registrableDomain: string,
): Promise<string | undefined> => {
	const cached = await deps.domainRegistration
		.get(registrableDomain)
		.catch((error: unknown) => {
			if (error instanceof NotFoundError) return undefined;
			throw error;
		});
	const registration =
		cached?.registration ??
		(await deps.rdap.lookup(registrableDomain).then(
			async (answer) => {
				if (answer === undefined) return undefined;
				await deps.domainRegistration.put({
					domainRegistrationId: registrableDomain,
					registration: answer,
				});
				return answer;
			},
			(error: unknown) => {
				deps.logger.info(
					{ registrableDomain, error: String(error) },
					"RDAP lookup failed; the registration date stays absent",
				);
				return undefined;
			},
		));
	return registration?.state === "Published"
		? registration.registeredAt
		: undefined;
};
