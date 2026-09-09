import { configOperationsGetConfigOptions } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { useQuery } from "@tanstack/react-query";

/**
 * Whether this instance stores message vectors (#1068).
 *
 * A property of the deployment, so it rides the config read every surface
 * already makes rather than a probe of its own: the semantic surfaces need the
 * answer before they have a query to send, and an empty semantic result is
 * indistinguishable from a mailbox with nothing similar in it.
 *
 * `undefined` while the config is in flight, and for a server that predates the
 * field. Callers must therefore branch on `=== false`, so an instance whose
 * answer has not arrived shows what it showed before rather than an off state
 * it may not be in.
 */
export const useSemanticSearchEnabled = (): boolean | undefined => {
	const { data } = useQuery({
		...configOperationsGetConfigOptions(),
		staleTime: Infinity,
	});
	return data?.semanticSearchEnabled;
};
