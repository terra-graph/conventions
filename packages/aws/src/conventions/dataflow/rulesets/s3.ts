import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const s3SemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_s3_bucket_notification'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_sns_topic',
              'aws_sqs_queue',
              'aws_cloudwatch_event_bus',
              'aws_kinesis_stream',
            ],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Publishes,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_s3_bucket'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_s3_bucket_notification', 'aws_cloudwatch_event_rule'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Triggers,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_s3_bucket'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_s3_bucket_notification'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Triggers,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudfront_distribution'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_s3_bucket'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default s3SemanticsRuleSet;
