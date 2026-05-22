import { coreBase } from '@terra-graph/conventions-core';
import { Profile, RemoveNode } from '@terra-graph/core';
import { conventionName, profileName, ruleName, ruleSetName } from '../../../namespaces.js';
import { ApiGatewayPlugin } from '../../../plugins/ApiGatewayPlugin.js';
import { IamPlugin } from '../../../plugins/IamPlugin.js';
import { AwsNetworkPlacementPlugin } from '../../../plugins/Network/AwsNetworkPlacementPlugin.js';
import { VpcTopologyPlugin } from '../../../plugins/Network/VpcTopologyPlugin.js';
import { S3Plugin } from '../../../plugins/S3Plugin.js';
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
    {
      phase: 'final',
      rules: [
        {
          namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('final')),
        },
      ],
    },
  ],
  plugins: [
    { plugin: S3Plugin.id },
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
    {
      plugin: ApiGatewayPlugin.id,
      slot: 'apigateway',
      options: { mode: 'standard' },
    },
    {
      plugin: IamPlugin.id,
      slot: 'iam',
      options: { mode: 'full', removeOrphans: true },
    },
    // { plugin: 'aws.iam', options: { mode: 'full' } },
    // {
    //   plugin: 'aws.iam',
    //   options: { mode: 'roles_policies', attachments: 'convert_to_edge' },
    // }, // can't see any difference
    // { plugin: 'aws.iam', options: { mode: 'full' } }, // shows everything as expected
    // {
    //   plugin: 'aws.iam',
    //   options: {
    //     mode: 'full',
    //   },
    // },
  ],
});
