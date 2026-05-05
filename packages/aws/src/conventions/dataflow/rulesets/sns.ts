import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const snsSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_sns_topic_subscription'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lambda_function'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Invokes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_sns_topic'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_sqs_queue',
              'aws_cloudwatch_event_rule',
              'aws_cloudwatch_event_archive',
              'aws_sfn_state_machine',
              'aws_ecs_service',
              'aws_sns_topic_subscription',
            ],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Triggers,
        enforceDirection: true,
      },
    }),
  ],
});

export default snsSemanticsRuleSet;
