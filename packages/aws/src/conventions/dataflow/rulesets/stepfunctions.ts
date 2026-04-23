import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const stepFunctionsSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_sfn_state_machine'],
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
            in: ['aws_sfn_state_machine'],
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
            in: ['aws_sfn_state_machine'],
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
        semantic: AwsEdgeDirectionSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  ],
});

export default stepFunctionsSemanticsRuleSet;
