import "typespec-electrodb-emitter";
import "./scalars/string.tsp";

model ResultList<T> {
  @doc("Opaque, server-minted cursor: absent means the first (or last) page, present means resume from here. Echo it back unchanged to fetch the next page. Every listing endpoint that accepts it rejects a token it cannot decode with 400 ValidationError rather than silently restarting from the first page (#136, #172).")
  @continuationToken
  continuationToken?: String800;
  items: T[];
}
