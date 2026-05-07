import { DotAdapter, Profile } from '@terra-graph/core';
import type { DotRendererOptions } from '@terra-graph/core';
import { conventionName, profileName, ruleName, ruleSetName } from '../../../namespaces.js';
import { Convention } from '../../index.js';
import base from './base.js';

export const conventionDataFlowDotProfileName = conventionName(
  Convention.DataFlow,
  profileName('dot'),
);

const baseDotProfile = new Profile<DotRendererOptions>('overview.dot', {
  supports: DotAdapter,
  render: {
    options: {
      graph: {
        rankdir: 'TB',
        ranksep: 2.5,
        nodesep: 0.6,
        pad: 1,
      },
    },
  },
  phases: [
    {
      phase: 'normalize',
      rules: [{ namedRule: 'dot.normalise_modules' }],
    },
  ],
});

export default new Profile(conventionDataFlowDotProfileName, {
  supports: DotAdapter,
  usesProfiles: [base, baseDotProfile],
  phases: [
    {
      phase: 'main',
      rules: [
        { namedRuleSet: ruleSetName('dot.sqs.dlq') },
        { namedRule: ruleName('dot.schedule.align') },
        { namedRule: ruleName('dot.iam_role.align') },
      ],
    },
  ],
});
