import { openSqliteTestStores } from "../test-stores.js";
import { accountSettingRepoSuite } from "./i4-account-setting.suite.js";

accountSettingRepoSuite(openSqliteTestStores);
