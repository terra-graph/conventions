import { EdgeSemantic, RemoveNode, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const lambdaPreRuleSet = new RuleSet({
  rules: [
    new RemoveNode({
      node: {
        and: [
          { attr: { key: 'terraform.resource', startsWith: 'aws_lambda' } },
          {
            not: {
              attr: {
                key: 'terraform.resource',
                in: [
                  'aws_lambda_function',
                  'aws_lambda_event_source_mapping',
                  'aws_lambda_permission',
                ],
              },
            },
          },
        ],
      },
    }),
  ],
});

export const lambdaSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_lambda_permission',
          },
        },
        to: {
          any: true,
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_sqs_queue', 'aws_kinesis_stream', 'aws_dynamodb_table'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lambda_event_source_mapping'],
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
            in: [
              'aws_sns_topic_subscription',
              'aws_s3_bucket_notification',
              'aws_lambda_function_url',
              'aws_cloudwatch_event_target',
              'aws_scheduler_schedule',
              'aws_apigatewayv2_route',
              'aws_apigatewayv2_stage',
              'aws_lambda_event_source_mapping',
            ],
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
            in: ['aws_lambda_function'],
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
            in: ['aws_lambda_function'],
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
        semantic: AwsEdgeSemantics.Accesses,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_lambda_function'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_service', 'aws_apigatewayv2_api'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  ],
});

export default lambdaSemanticsRuleSet;
