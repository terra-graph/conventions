import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const snsSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Invokes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
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
        semantic: AwsEdgeDirectionSemantics.Triggers,
        enforceDirection: true,
      },
    }),
  ],
});

export default snsSemanticsRuleSet;
