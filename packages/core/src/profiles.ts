import { Profile } from '@terra-graph/core';
import { profileName } from './namespaces.js';

export const coreBase = new Profile(profileName('base'), {
  phases: [
    {
      phase: 'pre',
      rules: [
        { namedRule: 'core.remove.tfconfig' },
        { namedRule: 'core.reconnect.time_sleep' },
        { namedRule: 'core.remove.childless_modules' },
      ],
    },
  ],
});
