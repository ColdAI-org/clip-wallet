export { type Described, assetFor, clearCoinCache, coinMeta, describeTransaction, gasOf, moveTarget, simulate } from "./describe.js";
export { GraphQLError, SuiGraphQL, plainSuiError } from "./graphql.js";
export * from "./module.js";
export * from "./networks.js";

import { createSuiModule } from "./module.js";
export const suiModule = createSuiModule();
