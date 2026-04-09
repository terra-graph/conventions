import { NamedRuleRegistry, ProfileRegistry, type RuntimeProvider } from '@terra-graph/core';
import { profileName } from './namespaces.js';
import { coreBase, coreDot } from './profiles.js';
import { coreNamedRules } from './rules.js';
import './Rules/registerAll.js';

export * from './profiles.js';
export * from './rules.js';

export default (): RuntimeProvider => ({
  namedRules: NamedRuleRegistry.from([coreNamedRules]),
  profiles: new ProfileRegistry({
    [profileName('base')]: coreBase,
    [profileName('dot')]: coreDot,
  }),
});
