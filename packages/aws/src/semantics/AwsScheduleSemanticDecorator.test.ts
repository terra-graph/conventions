import {
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asNodeId,
  edgeIdFrom,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import { AwsScheduleSemanticDecorator } from './AwsScheduleSemanticDecorator.js';

const requireDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
};

describe('AwsScheduleSemanticDecorator', () => {
  it('should derive schedule semantic facts from target.arn and project them onto projection edges', () => {
    const scheduleId = asNodeId('schedule');
    const lambdaId = asNodeId('lambda');
    const scheduleProjectionId = asNodeId('projection-schedule');
    const lambdaProjectionId = asNodeId('projection-lambda');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [scheduleId]: {
          id: scheduleId,
          terraform: {
            kind: 'resource',
            address: 'aws_scheduler_schedule.sqs_partition_consumer',
            resource: 'aws_scheduler_schedule',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_scheduler_schedule.sqs_partition_consumer',
                values: {
                  target: [
                    {
                      arn: 'arn:aws:lambda:eu-west-2:123456789012:function:event-flow',
                    },
                  ],
                },
              },
              instances: [],
            },
          },
        },
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.event_flow',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_lambda_function.event_flow',
                values: {
                  arn: 'arn:aws:lambda:eu-west-2:123456789012:function:event-flow',
                },
              },
              instances: [],
            },
          },
        },
        [scheduleProjectionId]: {
          id: scheduleProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_schedule:sqs_partition_consumer',
            label: 'sqs_partition_consumer',
            derivation: {
              source: 'plugin',
              rootNodeId: scheduleId,
            },
          },
        },
        [lambdaProjectionId]: {
          id: lambdaProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:event_flow',
            label: 'event_flow',
            derivation: {
              source: 'plugin',
              rootNodeId: lambdaId,
            },
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter(
      new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
    ).withTgGraph(graph);
    const decorator = new AwsScheduleSemanticDecorator();

    const extracted = decorator.extract({ graph: adapter });
    const rawEdge = extracted
      .outEdges(scheduleId)
      .find((edgeId) =>
        extracted
          .getEdgeAttributes(edgeId)
          ?.semantic?.facts?.some((fact) => fact.kind === 'schedules'),
      );
    expect(rawEdge).toBeDefined();

    const projected = decorator.project({ graph: extracted });
    const projectionEdge = projected
      .outEdges(scheduleProjectionId)
      .find((edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some((fact) => fact.kind === 'schedules'),
      );

    const definedProjectionEdge = requireDefined(projectionEdge);
    expect(projected.edgeSource(definedProjectionEdge)).toBe(scheduleProjectionId);
    expect(projected.edgeTarget(definedProjectionEdge)).toBe(lambdaProjectionId);
  });

  it('should resolve module-scope schedule targets during project using projected roots', () => {
    const scheduleId = asNodeId('schedule-scope');
    const moduleId = asNodeId('module-scope');
    const lambdaRootId = asNodeId('lambda-root');
    const roleRootId = asNodeId('role-root');
    const scheduleProjectionId = asNodeId('projection-schedule-scope');
    const lambdaAbiProjectionId = asNodeId('projection-lambda-scope-abi');
    const lambdaMeiProjectionId = asNodeId('projection-lambda-scope-mei');
    const lambdaMtiProjectionId = asNodeId('projection-lambda-scope-mti');
    const roleProjectionId = asNodeId('projection-role-scope');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [scheduleId]: {
          id: scheduleId,
          terraform: {
            kind: 'resource',
            address: 'aws_scheduler_schedule.gemini_bulk_requests["abi-afternoon"]',
            resource: 'aws_scheduler_schedule',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_scheduler_schedule.gemini_bulk_requests["abi-afternoon"]',
                index: 'abi-afternoon',
                values: { target: [{}] },
              },
              instances: [],
            },
            configuration: {
              source: 'plan_show',
              expressions: {
                target: [
                  {
                    arn: {
                      references: ['module.gemini_bulk_request', 'each.value.lambda_key'],
                    },
                  },
                ],
              },
            },
          },
        },
        [moduleId]: {
          id: moduleId,
          terraform: {
            kind: 'module',
            address: 'module.gemini_bulk_request',
            resource: 'module',
            name: 'gemini_bulk_request',
          },
        },
        [lambdaRootId]: {
          id: lambdaRootId,
          terraform: {
            kind: 'resource',
            address: 'module.gemini_bulk_request.aws_lambda_function.this',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'module.gemini_bulk_request["abi"].aws_lambda_function.this[0]',
                values: { function_name: 'gemini-abi' },
              },
              instances: [
                {
                  address: 'module.gemini_bulk_request["abi"].aws_lambda_function.this[0]',
                  index: 0,
                  values: { function_name: 'gemini-abi' },
                },
                {
                  address: 'module.gemini_bulk_request["mei"].aws_lambda_function.this[0]',
                  index: 0,
                  values: { function_name: 'gemini-mei' },
                },
                {
                  address: 'module.gemini_bulk_request["mti"].aws_lambda_function.this[0]',
                  index: 0,
                  values: { function_name: 'gemini-mti' },
                },
              ],
            },
          },
        },
        [roleRootId]: {
          id: roleRootId,
          terraform: {
            kind: 'resource',
            address: 'module.gemini_bulk_request.aws_iam_role.this',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: {
                address: 'module.gemini_bulk_request["abi"].aws_iam_role.this[0]',
                values: {},
              },
              instances: [
                {
                  address: 'module.gemini_bulk_request["abi"].aws_iam_role.this[0]',
                  index: 0,
                  values: {},
                },
              ],
            },
          },
        },
        [scheduleProjectionId]: {
          id: scheduleProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_schedule:gemini_bulk_requests["abi-afternoon"]',
            label: 'gemini_bulk_requests["abi-afternoon"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.eventbridge_schedule',
              rootNodeId: scheduleId,
            },
          },
        },
        [lambdaAbiProjectionId]: {
          id: lambdaAbiProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:gemini_bulk_request.this["abi"]',
            label: 'gemini_bulk_request.this["abi"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: lambdaRootId,
              rootInstanceAddress: 'module.gemini_bulk_request["abi"].aws_lambda_function.this[0]',
            },
          },
        },
        [lambdaMeiProjectionId]: {
          id: lambdaMeiProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:gemini_bulk_request.this["mei"]',
            label: 'gemini_bulk_request.this["mei"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: lambdaRootId,
              rootInstanceAddress: 'module.gemini_bulk_request["mei"].aws_lambda_function.this[0]',
            },
          },
        },
        [lambdaMtiProjectionId]: {
          id: lambdaMtiProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:gemini_bulk_request.this["mti"]',
            label: 'gemini_bulk_request.this["mti"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: lambdaRootId,
              rootInstanceAddress: 'module.gemini_bulk_request["mti"].aws_lambda_function.this[0]',
            },
          },
        },
        [roleProjectionId]: {
          id: roleProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.iam_role:gemini_bulk_request.this["abi"]',
            label: 'gemini_bulk_request.this["abi"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.iam_role',
              rootNodeId: roleRootId,
            },
          },
        },
      },
      edges: [],
    };

    const adapter = new GraphologyAdapter(
      new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
    ).withTgGraph(graph);
    const decorator = new AwsScheduleSemanticDecorator();

    const extracted = decorator.extract({ graph: adapter });
    expect(extracted.outEdges(scheduleId)).toHaveLength(0);

    const projected = decorator.project({ graph: extracted });
    const projectionEdge = projected
      .outEdges(scheduleProjectionId)
      .find((edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some((fact) => fact.kind === 'schedules'),
      );

    const definedProjectionEdge = requireDefined(projectionEdge);
    expect(projected.edgeSource(definedProjectionEdge)).toBe(scheduleProjectionId);
    expect(projected.edgeTarget(definedProjectionEdge)).toBe(lambdaAbiProjectionId);
    expect(projected.edgeTarget(definedProjectionEdge)).not.toBe(lambdaMeiProjectionId);
    expect(projected.edgeTarget(definedProjectionEdge)).not.toBe(lambdaMtiProjectionId);
    expect(projected.edgeTarget(definedProjectionEdge)).not.toBe(roleProjectionId);
  });

  it('should fall back to outgoing module edges when schedule target references are unavailable during project', () => {
    const scheduleId = asNodeId('schedule-fallback');
    const supportId = asNodeId('support-fallback');
    const lambdaRootId = asNodeId('lambda-root-fallback');
    const roleRootId = asNodeId('role-root-fallback');
    const scheduleProjectionId = asNodeId('projection-schedule-fallback');
    const lambdaAbiProjectionId = asNodeId('projection-lambda-fallback-abi');
    const roleProjectionId = asNodeId('projection-role-fallback');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [scheduleId]: {
          id: scheduleId,
          terraform: {
            kind: 'resource',
            address: 'aws_scheduler_schedule.gemini_bulk_requests["abi-afternoon"]',
            resource: 'aws_scheduler_schedule',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_scheduler_schedule.gemini_bulk_requests["abi-afternoon"]',
                index: 'abi-afternoon',
                values: { target: [{}] },
              },
              instances: [],
            },
          },
        },
        [supportId]: {
          id: supportId,
          terraform: {
            kind: 'resource',
            address: 'module.gemini_bulk_request.aws_lambda_permission.current_version_triggers',
            resource: 'aws_lambda_permission',
            state: {
              source: 'plan_show',
              effective: {
                address:
                  'module.gemini_bulk_request["abi"].aws_lambda_permission.current_version_triggers[0]',
                values: {},
              },
              instances: [
                {
                  address:
                    'module.gemini_bulk_request["abi"].aws_lambda_permission.current_version_triggers[0]',
                  index: 0,
                  values: {},
                },
              ],
            },
          },
        },
        [lambdaRootId]: {
          id: lambdaRootId,
          terraform: {
            kind: 'resource',
            address: 'module.gemini_bulk_request.aws_lambda_function.this',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'module.gemini_bulk_request["abi"].aws_lambda_function.this[0]',
                values: { function_name: 'gemini-abi' },
              },
              instances: [
                {
                  address: 'module.gemini_bulk_request["abi"].aws_lambda_function.this[0]',
                  index: 0,
                  values: { function_name: 'gemini-abi' },
                },
              ],
            },
          },
        },
        [roleRootId]: {
          id: roleRootId,
          terraform: {
            kind: 'resource',
            address: 'module.gemini_bulk_request.aws_iam_role.lambda',
            resource: 'aws_iam_role',
            state: {
              source: 'plan_show',
              effective: {
                address: 'module.gemini_bulk_request["abi"].aws_iam_role.lambda[0]',
                values: {},
              },
              instances: [
                {
                  address: 'module.gemini_bulk_request["abi"].aws_iam_role.lambda[0]',
                  index: 0,
                  values: {},
                },
              ],
            },
          },
        },
        [scheduleProjectionId]: {
          id: scheduleProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_schedule:gemini_bulk_requests["abi-afternoon"]',
            label: 'gemini_bulk_requests["abi-afternoon"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.eventbridge_schedule',
              rootNodeId: scheduleId,
              instanceKey: 'abi-afternoon',
            },
          },
        },
        [lambdaAbiProjectionId]: {
          id: lambdaAbiProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:gemini_bulk_request.this["abi"]',
            label: 'gemini_bulk_request.this["abi"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: lambdaRootId,
              rootInstanceAddress: 'module.gemini_bulk_request["abi"].aws_lambda_function.this[0]',
              instanceKey: 'abi',
            },
          },
        },
        [roleProjectionId]: {
          id: roleProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.iam_role:gemini_bulk_request.lambda["abi"]',
            label: 'gemini_bulk_request.lambda["abi"]',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.iam_role',
              rootNodeId: roleRootId,
              rootInstanceAddress: 'module.gemini_bulk_request["abi"].aws_iam_role.lambda[0]',
              instanceKey: 'abi',
            },
          },
        },
      },
      edges: [
        {
          id: edgeIdFrom(scheduleId, supportId),
          from: scheduleId,
          to: supportId,
        },
      ],
    };

    const adapter = new GraphologyAdapter(
      new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
    ).withTgGraph(graph);
    const decorator = new AwsScheduleSemanticDecorator();

    const projected = decorator.project({ graph: adapter });
    const projectionEdge = projected
      .outEdges(scheduleProjectionId)
      .find((edgeId) =>
        projected
          .getEdgeAttributes(edgeId)
          ?.projection?.semantics?.facts?.some((fact) => fact.kind === 'schedules'),
      );

    const definedProjectionEdge = requireDefined(projectionEdge);
    expect(projected.edgeSource(definedProjectionEdge)).toBe(scheduleProjectionId);
    expect(projected.edgeTarget(definedProjectionEdge)).toBe(lambdaAbiProjectionId);
    expect(projected.edgeTarget(definedProjectionEdge)).not.toBe(roleProjectionId);
  });
});
