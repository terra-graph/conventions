import { coreBase } from '@terra-graph/conventions-core';
import { Profile, RemoveNode } from '@terra-graph/core';
import { conventionName, profileName, ruleSetName } from '../../../namespaces.js';
import { AwsNetworkPlacementPlugin } from '../../../plugins/Network/AwsNetworkPlacementPlugin.js';
import { VpcTopologyPlugin } from '../../../plugins/Network/VpcTopologyPlugin.js';
import { Convention } from '../../index.js';

export const conventionDataFlowBaseProfileName = conventionName(
  Convention.DataFlow,
  profileName('base'),
);

export default new Profile(conventionDataFlowBaseProfileName, {
  usesProfiles: [coreBase],
  phases: [
    {
      phase: 'pre',
      rules: [
        new RemoveNode({
          node: {
            or: [
              {
                attr: {
                  key: 'terraform.resource',
                  startsWith: ['aws_kms_', 'aws_ssm_'],
                },
              },
              {
                attr: {
                  key: 'terraform.resource',
                  in: ['external', 'aws_caller_identity'],
                },
              },
            ],
          },
        }),
      ],
    },
    {
      phase: 'main',
      rules: [
        {
          namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('main')),
        },
      ],
    },
  ],
  plugins: [
    {
      plugin: VpcTopologyPlugin.id,
      slot: 'topology',
    },
    {
      plugin: AwsNetworkPlacementPlugin.id,
      slot: 'topology-placement',
      options: {
        enrichers: ['ecs', 'efs', 'network'],
      },
    },
  ],
});
