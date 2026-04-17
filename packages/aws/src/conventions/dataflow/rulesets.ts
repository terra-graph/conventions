import {
  EdgeDirectionSemantic,
  EdgeSemanticLegend,
  NamedRuleSetRegistry,
  RemoveNode,
  RuleSet,
} from '@terra-graph/core';
import { conventionName, ruleSetName } from '../../namespaces.js';
import { Convention } from '../index.js';
import { AwsEdgeDirectionSemantics } from './edgeSemantics.js';

export default new NamedRuleSetRegistry({
  [conventionName(Convention.DataFlow, ruleSetName('cleanup'))]: new RuleSet({
    rules: [
      new RemoveNode({
        node: {
          and: [
            { attr: { key: 'terraform.resource', eq: 'aws_lambda_event_source_mapping' } },
            { not: { edge: { in: { any: true } } } },
          ],
        },
      }),
    ],
  }),
  [conventionName(Convention.DataFlow, ruleSetName('semantics'))]: new RuleSet({
    rules: [
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              startsWith: 'aws_iam_',
            },
          },
          to: {
            any: true,
          },
        },
        options: {
          semantic: AwsEdgeDirectionSemantics.Authorizes,
        },
      }),
      new EdgeDirectionSemantic({
        edge: {
          from: {
            and: [
              {
                attr: {
                  key: 'terraform.resource',
                  endsWith: '_policy',
                },
              },
              {
                not: {
                  attr: {
                    key: 'terraform.resource',
                    startsWith: 'aws_iam_',
                  },
                },
              },
            ],
          },
          to: {
            any: true,
          },
        },
        options: {
          semantic: AwsEdgeDirectionSemantics.Authorizes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
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
          semantic: AwsEdgeDirectionSemantics.Authorizes,
          enforceDirection: true,
        },
      }),
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
          semantic: AwsEdgeDirectionSemantics.Invokes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
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
          semantic: AwsEdgeDirectionSemantics.Invokes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
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
          semantic: AwsEdgeDirectionSemantics.Triggers,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_dynamodb_table'],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_dynamodb_table_item'],
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
              in: [
                'aws_sns_topic_subscription',
                'aws_s3_bucket_notification',
                'aws_lambda_function_url',
                'aws_cloudwatch_event_target',
                'aws_scheduler_schedule',
                'aws_api_gatewayv2_route',
                'aws_api_gateway_stage',
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
          semantic: AwsEdgeDirectionSemantics.Invokes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_scheduler_schedule'],
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
          semantic: AwsEdgeDirectionSemantics.Invokes,
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
              in: [
                'aws_s3_bucket_notification',
                'aws_cloudwatch_event_rule', // when using eventbridge
              ],
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
              in: [
                'aws_lambda_function',
                'aws_ecs_service',
                'aws_ecs_task_definition',
                'aws_sfn_state_machine',
                'aws_apigatewayv2_api',
                'aws_s3_bucket_notification',
              ],
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
              in: ['aws_secretsmanager_secret_version'],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              startsWith: ['aws_secretsmanager_secret'],
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
              in: [
                'aws_lambda_function',
                'aws_ecs_service',
                'aws_ecs_task_definition',
                'aws_glue_job',
                // 'aws_athena_named_query',
                'aws_glue_catalog_table',
                'aws_glue_catalog_database',
                'aws_sfn_state_machine',
                'aws_cloudwatch_log_delivery_destination',
              ],
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
              in: ['aws_athena_named_query'],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              startsWith: ['aws_glue_catalog_database'],
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
              eq: 'aws_sqs_queue',
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              eq: 'aws_sqs_queue',
            },
          },
        },
        options: {
          semantic: AwsEdgeDirectionSemantics.Publishes,
          enforceDirection: true,
        },
      }),
      // this is the generic one
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: [
                // 'aws_sqs_queue',
                'aws_sns_topic',
                // 'aws_kinesis_stream',
                // 'aws_dynamodb_table',
                'aws_cloudwatch_event_bus',
                // 'aws_cloudwatch_event_target',
                'aws_scheduler_schedule',
                // 'aws_s3_bucket',
              ],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              in: [
                // 'aws_lambda_event_source_mapping',
                'aws_sqs_queue',
                'aws_cloudwatch_event_rule',
                'aws_cloudwatch_event_archive',
                'aws_sfn_state_machine',
                'aws_ecs_service',
                // 'aws_s3_bucket_notification',
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
      // another weird generic rule
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: [
                'aws_apigatewayv2_api',
                'aws_api_gateway_rest_api',
                'aws_lambda_function',
                'aws_sfn_state_machine',
                // 'aws_cloudwatch_event_rule',
              ],
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
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: [
                'aws_apigatewayv2_api',
                'aws_api_gateway_rest_api',
                'aws_lb',
                'aws_lb_listener',
                'aws_cloudfront_distribution',
                'aws_route53_record',
              ],
            },
          },
          to: {
            not: {
              attr: {
                key: 'terraform.resource',
                startsWith: [
                  'aws_waf',
                  'aws_acm_certificate_',
                  'aws_cloudfront_origin_access_control',
                  'aws_cloudwatch_log_delivery_source',
                ],
              },
            },
          },
        },
        options: {
          semantic: AwsEdgeDirectionSemantics.Routes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_glue_catalog_database', 'aws_timestreamwrite_database'],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_glue_catalog_table', 'aws_timestreamwrite_table'],
            },
          },
        },
        options: {
          semantic: AwsEdgeDirectionSemantics.Routes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_wafv2_ip_set'],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_wafv2_web_acl'],
            },
          },
        },
        options: {
          semantic: AwsEdgeDirectionSemantics.Authorizes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: [
                'aws_wafv2_web_acl',
                'aws_acm_certificate_validation',
                'aws_cloudfront_origin_access_control',
              ],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_cloudfront_distribution'],
            },
          },
        },
        options: {
          semantic: AwsEdgeDirectionSemantics.Authorizes,
          enforceDirection: true,
        },
      }),
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_wafv2_web_acl'],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_wafv2_web_acl_logging_configuration'],
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
      new EdgeDirectionSemantic({
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_wafv2_web_acl_logging_configuration'],
            },
          },
          to: {
            attr: {
              key: 'terraform.resource',
              in: ['aws_kinesis_firehose_delivery_stream'],
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
      new EdgeSemanticLegend({
        edge: {
          from: { any: true },
          to: { any: true },
        },
        options: {
          legendBySemantic: {
            [AwsEdgeDirectionSemantics.Invokes]: {
              title: 'Invokes',
              colour: '#0d6efd',
            },
            [AwsEdgeDirectionSemantics.Accesses]: {
              title: 'Accesses data',
              colour: '#198754',
            },
            [AwsEdgeDirectionSemantics.Publishes]: {
              title: 'Publishes event',
              colour: '#fd7e14',
            },
            [AwsEdgeDirectionSemantics.Triggers]: {
              title: 'Triggers async consumer',
              colour: '#dc3545',
            },
            [AwsEdgeDirectionSemantics.Routes]: {
              title: 'Routes request',
              colour: '#6f42c1',
            },
            [AwsEdgeDirectionSemantics.Authorizes]: {
              title: 'Authorizes',
              colour: '#8dd7c5',
            },
            [AwsEdgeDirectionSemantics.ObservedBy]: {
              title: 'Observed by telemetry',
              colour: '#20c997',
            },
          },
        },
      }),
    ],
  }),
});
