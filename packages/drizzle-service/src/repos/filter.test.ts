import { openSqliteTestStores } from "../test-stores.js";
import { filterRepoSuite } from "./filter.suite.js";

filterRepoSuite(openSqliteTestStores);
