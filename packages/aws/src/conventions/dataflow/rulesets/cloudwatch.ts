import { EdgeDirectionSemantic, RemoveNode, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const cloudwatchPreRuleSet = new RuleSet({
  rules: [
    new RemoveNode({
      node: {
        and: [
          {
            attr: {
              key: 'terraform.resource',
              eq: 'aws_cloudwatch_log_group',
            },
          },
          {
            not: {
              edge: {
                in: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_cloudwatch_event_target',
                  },
                },
              },
            },
          },
        ],
      },
    }),
  ],
});

export const cloudwatchSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          any: true,
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_group', 'aws_cloudwatch_metric_alarm', 'aws_xray_group'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.ObservedBy,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_delivery_source'],
          },
        },
        to: {
          not: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_cloudwatch_log_delivery'],
            },
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.ObservedBy,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_delivery_source'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_delivery'],
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
            in: ['aws_cloudwatch_log_delivery_destination'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            startsWith: [
              'aws_dynamodb_',
              'aws_s3_',
              'aws_rds_',
              'aws_docdb_',
              'aws_elasticache_',
              'aws_opensearch_',
              'aws_timestream',
              'aws_redshift_',
              'aws_secretsmanager_secret_version',
            ],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Accesses,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_delivery'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_delivery_destination'],
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
            in: ['aws_kinesis_firehose_delivery_stream'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_cloudwatch_log_stream'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  ],
});

export default cloudwatchSemanticsRuleSet;
