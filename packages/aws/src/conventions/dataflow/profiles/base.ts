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
      phase: 'normalize',
      rules: [{ namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('normalize')) }],
    },
    {
      phase: 'semantics',
      rules: [{ namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('semantics')) }],
    },
    {
      phase: 'main',
      rules: [
        // TODO: ConvertNodeToEdge probably should apply some hints to the edge (converted node etc)
        // new ConvertNodeToEdge({
        //   node: {
        //     attr: {
        //       key: 'terraform.resource',
        //       in: [
        //         'aws_lambda_event_source_mapping',
        //         'aws_cloudwatch_event_target',
        //         'aws_cloudwatch_log_destination',
        //       ],
        //     },
        //   },
        // }),
      ],
    },
    {
      phase: 'cleanup',
      rules: [
        { namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('cleanup')) },
      ],
    },
    {
      phase: 'cleanup',
      rules: [
        // Re-run semantics in a separate later cleanup phase because cleanup rules can create
        // redirected edges (for example ALB -> ECS after listener/target-group removal). A
        // single resolver phase only visits the node ids captured at phase start, so this must
        // be its own phase step rather than another ruleset entry in the same cleanup step.
        { namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('semantics')) },
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
