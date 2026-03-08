import {
  EdgeDirectionSemantic,
  EdgeSemanticLegend,
  NamedRuleRegistry,
  TgEdgeDirectionSemantics,
} from 'terra-graph';
import { conventionName, ruleName } from '../../namespaces.js';
import { Convention } from '../index.js';

export default new NamedRuleRegistry({
  [conventionName(Convention.DataFlow, ruleName('authorizes.iam_to_targets'))]:
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
        semantic: TgEdgeDirectionSemantics.Authorizes,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('authorizes.non_iam_policies_to_targets'))]:
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
        semantic: TgEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('authorizes.lambda_permissions_to_targets'))]:
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
        semantic: TgEdgeDirectionSemantics.Authorizes,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('observed_by.telemetry_targets'))]:
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
        semantic: TgEdgeDirectionSemantics.ObservedBy,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('triggers.async_sources_to_consumers'))]:
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_sqs_queue',
              'aws_sns_topic',
              'aws_kinesis_stream',
              'aws_dynamodb_table',
              'aws_cloudwatch_event_bus',
              'aws_cloudwatch_event_target',
              'aws_scheduler_schedule',
              'aws_s3_bucket',
            ],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: [
              // 'aws_lambda_function',
              'aws_lambda_event_source_mapping',
              'aws_cloudwatch_event_rule',
              'aws_cloudwatch_event_archive',
              'aws_stepfunctions_state_machine',
              'aws_ecs_service',
              'aws_s3_bucket_notification',
            ],
          },
        },
      },
      options: {
        semantic: TgEdgeDirectionSemantics.Triggers,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('publishes.producers_to_brokers'))]:
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_lambda_function',
              'aws_ecs_service',
              'aws_ecs_task_definition',
              'aws_stepfunctions_state_machine',
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
        semantic: TgEdgeDirectionSemantics.Publishes,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('accesses.compute_to_data_stores'))]:
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
              'aws_athena_named_query',
              'aws_glue_catalog_table',
              'aws_glue_catalog_database',
              'aws_stepfunctions_state_machine',
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
              'aws_timestream_',
              'aws_redshift_',
              'aws_secretsmanager_',
            ],
          },
        },
      },
      options: {
        semantic: TgEdgeDirectionSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('invokes.sync_request_calls'))]:
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_apigatewayv2_api',
              'aws_api_gateway_rest_api',
              'aws_lambda_function',
              'aws_stepfunctions_state_machine',
              'aws_cloudwatch_event_rule',
            ],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: [
              'aws_lambda_function',
              'aws_ecs_service',
              'aws_apigatewayv2_api',
              'aws_cloudwatch_event_target',
            ],
          },
        },
      },
      options: {
        semantic: TgEdgeDirectionSemantics.Invokes,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('routes.routing_tier_to_services'))]:
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
          any: true,
        },
      },
      options: {
        semantic: TgEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('routes.catalog_database_to_table'))]:
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_glue_catalog_database',
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            eq: 'aws_glue_catalog_table',
          },
        },
      },
      options: {
        semantic: TgEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
  [conventionName(Convention.DataFlow, ruleName('legend'))]: new EdgeSemanticLegend({
    edge: {
      from: { any: true },
      to: { any: true },
    },
    options: {
      legendBySemantic: {
        [TgEdgeDirectionSemantics.Invokes]: {
          title: 'Invokes',
          colour: '#0d6efd',
        },
        [TgEdgeDirectionSemantics.Accesses]: {
          title: 'Accesses data',
          colour: '#198754',
        },
        [TgEdgeDirectionSemantics.Publishes]: {
          title: 'Publishes event',
          colour: '#fd7e14',
        },
        [TgEdgeDirectionSemantics.Triggers]: {
          title: 'Triggers async consumer',
          colour: '#dc3545',
        },
        [TgEdgeDirectionSemantics.Routes]: {
          title: 'Routes request',
          colour: '#6f42c1',
        },
        [TgEdgeDirectionSemantics.Authorizes]: {
          title: 'Authorizes',
          colour: '#8dd7c5',
        },
        [TgEdgeDirectionSemantics.ObservedBy]: {
          title: 'Observed by telemetry',
          colour: '#20c997',
        },
      },
    },
  }),
});
