import "typespec-electrodb-emitter";
import "./scalars/string.tsp";

model ResultList<T> {
  @continuationToken continuationToken?: String800;
  items: T[];
}
