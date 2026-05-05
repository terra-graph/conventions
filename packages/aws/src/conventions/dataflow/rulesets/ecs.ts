import { EdgeSemantic, RemoveNode, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const ecsSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_service'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_task_definition'],
          },
        },
      },
      options: {
        semantic: AwsEdgeSemantics.Invokes,
      },
    }),
    new EdgeSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_ecs_service', 'aws_ecs_task_definition'],
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
            in: ['aws_ecs_service', 'aws_ecs_task_definition'],
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
  ],
});

export const ecsCleanupRuleSet = new RuleSet({
  rules: [
    new RemoveNode({
      node: {
        attr: {
          key: 'terraform.resource',
          eq: 'aws_ecs_cluster',
        },
      },
    }),
  ],
});

export default ecsSemanticsRuleSet;
