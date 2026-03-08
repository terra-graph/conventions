import {
  ConvertNodeToEdge,
  DotAdapter,
  Profile,
  RemoveNode,
  baseDotProfile,
  overviewCore,
} from 'terra-graph';
import { conventionName, profileName, ruleName, ruleSetName } from '../../../namespaces.js';
import { AwsIamGraphPlugin } from '../../../plugins/AwsIam.js';
import { AwsS3 } from '../../../plugins/AwsS3.js';
import { Convention } from '../../index.js';

export const conventionDataFlowDotProfileName = conventionName(
  Convention.DataFlow,
  profileName('dot'),
);

export default new Profile(conventionDataFlowDotProfileName, {
  supports: DotAdapter,
  usesProfiles: [overviewCore, baseDotProfile],
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
                  startsWith: [
                    'aws_kms_',
                    'aws_ssm_',
                    // 'aws_iam_'
                  ],
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
      phase: 'main',
      rules: [
        { namedRuleSet: ruleSetName('dot.sqs.dlq') },
        { namedRule: ruleName('dot.schedule.align') },
        { namedRule: ruleName('dot.iam_role.align') },
      ],
    },
    {
      phase: 'semantics',
      rules: [{ namedRuleSet: conventionName(Convention.DataFlow, ruleSetName('semantics')) }],
    },
    {
      phase: 'main',
      rules: [
        // TODO: check - does this maintain the edgeSemanticDirection stuff?
        // I don't think it will - might need to run the convetions ruleset again?
        new ConvertNodeToEdge({
          node: {
            attr: {
              key: 'terraform.resource',
              in: [
                'aws_lambda_event_source_mapping',
                'aws_cloudwatch_event_target',
                'aws_cloudwatch_log_destination',
              ],
            },
          },
        }),
      ],
    },
  ],
  plugins: [
    { plugin: AwsS3.id },
    {
      plugin: AwsIamGraphPlugin.id,
      options: { mode: 'full', removeOrphans: true },
    }, // fine
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
