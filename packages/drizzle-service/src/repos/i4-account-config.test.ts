import { openSqliteTestStores } from "../test-stores.js";
import { accountConfigRepoSuite } from "./i4-account-config.suite.js";

accountConfigRepoSuite(openSqliteTestStores);
