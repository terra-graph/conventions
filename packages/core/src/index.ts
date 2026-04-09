import { NamedRuleRegistry, type RuntimeProvider } from '@terra-graph/core';
import { coreNamedRules } from './rules.js';

export * from './profiles.js';
export * from './rules.js';

export default (): RuntimeProvider => ({
  namedRules: NamedRuleRegistry.from([coreNamedRules]),
});
