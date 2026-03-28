import { coreBase } from '@terra-graph/conventions-core';
import { Profile, RemoveNode } from '@terra-graph/core';
import { conventionName, profileName, ruleName, ruleSetName } from '../../../namespaces.js';
import { AwsIamGraphPlugin } from '../../../plugins/AwsIam.js';
import { AwsS3 } from '../../../plugins/AwsS3.js';
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
        // { namedRule: ruleName('log_groups.only_event_bridge') },
        { namedRule: ruleName('lambda.only_event_source_mapping') },
      ],
    },
    {
      phase: 'semantics',
      rules: [{ namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('semantics')) }],
    },
    {
      phase: 'cleanup',
      rules: [
        // not sure this semantics re-run is needed?
        { namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('semantics')) },
        { namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('cleanup')) },
      ],
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
  ],
  plugins: [
    { plugin: AwsS3.id },
    {
      plugin: AwsIamGraphPlugin.id,
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
