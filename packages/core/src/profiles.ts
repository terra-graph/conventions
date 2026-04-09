import { NodeProperties, Profile } from '@terra-graph/core';
import { DotNodeLabel } from './Rules/Node/DotNodeLabel.js';
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

export const coreDot = new Profile(profileName('dot'), {
  usesProfiles: [coreBase],
  phases: [
    {
      phase: 'main',
      rules: [
        new DotNodeLabel({
          node: {
            any: true,
          },
        }),
      ],
    },
  ],
});
