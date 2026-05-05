import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const s3SemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Publishes,
      },
    }),
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Triggers,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Triggers,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default s3SemanticsRuleSet;
