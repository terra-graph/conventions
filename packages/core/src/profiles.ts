import { Profile } from '@terra-graph/core';
import { DotNodeLabel } from './Rules/Node/DotNodeLabel.js';
import { profileName } from './namespaces.js';

export const coreBase = new Profile(profileName('base'), {
  phases: [
    {
      phase: 'pre',
      rules: [
        { namedRule: 'core.remove.tfconfig' },
        { namedRule: 'core.remove.tfconfig_artifacts' },
        { namedRule: 'core.reconnect.time_sleep' },
        { namedRule: 'core.materialize.cardinality_resources' },
        // { namedRule: 'core.remove.childless_modules' },
      ],
    },
    {
      phase: 'main',
      rules: [{ namedRule: 'core.remove.self_loops' }],
    },
  ],
});

export const coreDot = new Profile(profileName('dot'), {
  usesProfiles: [coreBase],
  phases: [
    {
      phase: 'pre',
      rules: [
        { namedRule: 'core.remove.outputs' },
        { namedRule: 'core.remove.providers' },
        { namedRule: 'core.remove.root' },
        { namedRule: 'core.remove.artifacts' },
      ],
    },
    {
      phase: 'final',
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
