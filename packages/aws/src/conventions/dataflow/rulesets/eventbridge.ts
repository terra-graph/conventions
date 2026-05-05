import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const eventBridgeSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_event_target'],
          },
        },
        to: {
          not: {
            attr: {
              key: 'terraform.resource',
              startsWith: ['aws_cloudwatch_event_', 'aws_iam_'],
            },
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
            eq: 'aws_cloudwatch_event_rule',
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_event_target', 'aws_sqs_queue'],
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
            in: ['aws_sns_topic', 'aws_cloudwatch_event_bus', 'aws_scheduler_schedule'],
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

export default eventBridgeSemanticsRuleSet;
