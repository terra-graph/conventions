import { Profile } from '@terra-graph/core';
import { profileName } from './namespaces.js';

export const coreBase = new Profile(profileName('base'), {
  phases: [
    {
      phase: 'pre',
      rules: [
        { namedRule: 'remove.tfconfig' },
        { namedRule: 'reconnect.time_sleep' },
        { namedRule: 'remove.childless_modules' },
      ],
    },
  ],
});
