import {
  GraphologyAdapter,
  type SemanticReferenceCandidate,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
  setNodeSemanticContext,
} from '@terra-graph/core';
import { DirectedGraph } from 'graphology';
import { AwsScheduleSemanticDecorator, __testing } from './AwsScheduleSemanticDecorator.js';

type ScheduleProjectionGraph = Parameters<(typeof __testing)['collectProjectionIdsInScope']>[0];
type ScheduleAdapter = Parameters<AwsScheduleSemanticDecorator['project']>[0]['graph'];

const buildAdapter = (graph: TgGraph): ScheduleAdapter =>
  new GraphologyAdapter(
    new DirectedGraph() as unknown as ConstructorParameters<typeof GraphologyAdapter>[0],
  ).withTgGraph(graph);

const createMockGraph = (
  nodes: Record<string, unknown>,
  edges: Array<{ id: string; from: string; to: string; attributes?: Record<string, unknown> }>,
) =>
  ({
    nodeIds: () => Object.keys(nodes),
    getNodeAttributes: (nodeId: string) => nodes[nodeId],
    outEdges: (nodeId: string) =>
      edges.filter((edge) => edge.from === nodeId).map((edge) => edge.id),
    inEdges: (nodeId: string) => edges.filter((edge) => edge.to === nodeId).map((edge) => edge.id),
    edgeTarget: (edgeId: string) => edges.find((edge) => edge.id === edgeId)?.to,
    edgeSource: (edgeId: string) => edges.find((edge) => edge.id === edgeId)?.from,
    getEdgeAttributes: (edgeId: string) =>
      edges.find((edge) => edge.id === edgeId)?.attributes ?? {},
  }) as unknown as ScheduleProjectionGraph;

describe('AwsScheduleSemanticDecorator internals', () => {
  it('should cover helper functions', () => {
    expect(__testing.resolveLambdaFunctionName({} as never)).toBeUndefined();
    expect(
      __testing.resolveLambdaFunctionName({
        terraform: {
          state: {
            effective: {
              values: {
                function_name: 'event-flow',
              },
            },
          },
        },
      } as never),
    ).toBe('event-flow');

    expect(__testing.resolveScheduleTargetArn({} as never)).toBeUndefined();
    expect(
      __testing.resolveScheduleTargetArn({
        terraform: {
          state: {
            effective: {
              values: {
                target: ['invalid', { arn: 'arn:aws:lambda:eu-west-2:123:function:event-flow' }],
              },
            },
          },
        },
      } as never),
    ).toBe('arn:aws:lambda:eu-west-2:123:function:event-flow');

    expect(__testing.resolveScheduleTargetReferences({} as never)).toStrictEqual([]);
    expect(
      __testing.resolveScheduleTargetReferences({
        terraform: {
          configuration: {
            expressions: {
              target: ['invalid', { arn: { references: ['module.jobs', 'module.jobs'] } }],
            },
          },
        },
      } as never),
    ).toStrictEqual(['module.jobs']);

    expect(__testing.moduleReferenceFromAddress('aws_lambda_function.fn')).toBeUndefined();
    expect(
      __testing.moduleReferenceFromAddress('module.jobs.module.worker.aws_lambda_function.fn'),
    ).toBe('module.jobs.module.worker');
    expect(__testing.lambdaFunctionNameFromArn('invalid')).toBeUndefined();
    expect(
      __testing.lambdaFunctionNameFromArn('arn:aws:lambda:eu-west-2:123:function:event-flow'),
    ).toBe('event-flow');

    expect(__testing.supportResourceTypePenalty(undefined)).toBe(0);
    expect(__testing.supportResourceTypePenalty('aws_lambda_permission')).toBe(-25);
    expect(__testing.supportResourceTypePenalty('aws_iam_role')).toBe(-20);
    expect(__testing.targetResourceTypeBonus(undefined)).toBe(0);
    expect(__testing.targetResourceTypeBonus('aws_lambda_function')).toBe(40);
    expect(__testing.targetResourceTypeBonus('aws_unknown')).toBe(10);
    expect(__testing.tokenize(undefined)).toStrictEqual([]);
    expect(__testing.tokenize('ABI-Flow_1')).toStrictEqual(['abi', 'flow', '1']);

    const scopeGraph = createMockGraph(
      {
        missingRoot: {
          projection: {
            derivation: {},
          },
        },
        scopedProjection: {
          projection: {
            derivation: {
              rootNodeId: asNodeId('root'),
              rootInstanceAddress: 'module.jobs["abi"].aws_lambda_function.fn[0]',
            },
          },
        },
      },
      [],
    );
    expect(__testing.collectProjectionIdsInScope(scopeGraph, 'module.jobs["abi"]')).toStrictEqual([
      'scopedProjection',
    ]);
    expect(
      __testing.collectModuleReferencesFromOutgoingEdges(
        createMockGraph(
          {
            source: {},
            missingAddressTarget: {},
            moduleTarget: {
              terraform: {
                address: 'module.jobs.aws_lambda_function.fn',
              },
            },
          },
          [
            { id: 'source-missing', from: 'source', to: 'missingAddressTarget' },
            { id: 'source-module', from: 'source', to: 'moduleTarget' },
          ],
        ),
        asNodeId('source'),
      ),
    ).toStrictEqual(['module.jobs']);
  });

  it('should select the best schedule reference candidate and projection target', () => {
    const scheduleProjectionId = asNodeId('projection-schedule');
    const rawTargetId = asNodeId('raw-target');
    const graph = createMockGraph(
      {
        [scheduleProjectionId]: {
          projection: {
            derivation: {
              rootNodeId: asNodeId('raw-schedule'),
            },
          },
        },
        preferredProjection: {
          projection: {
            derivation: {
              rootNodeId: rawTargetId,
              rootInstanceAddress: 'module.jobs["abi"].aws_lambda_function.fn[0]',
              instanceKey: 'abi',
              anchors: [{ nodeId: rawTargetId }],
            },
          },
        },
        otherProjection: {
          projection: {
            derivation: {
              rootNodeId: asNodeId('other-target'),
              instanceKey: 'mei',
            },
          },
        },
        missingRootProjection: {
          projection: {
            derivation: {},
          },
        },
        [rawTargetId]: {
          terraform: {
            resource: 'aws_lambda_function',
          },
        },
        [asNodeId('other-target')]: {
          terraform: {
            resource: 'aws_sqs_queue',
          },
        },
        moduleNode: {
          terraform: {
            kind: 'module',
          },
        },
        resourceNode: {
          terraform: {
            kind: 'resource',
          },
        },
      },
      [],
    );

    expect(
      __testing.selectBestProjectionTarget(
        graph,
        scheduleProjectionId,
        [scheduleProjectionId, asNodeId('missingRootProjection')],
        { confidence: 'heuristic' },
      ),
    ).toBeUndefined();

    expect(
      __testing.selectBestProjectionTarget(
        graph,
        scheduleProjectionId,
        [asNodeId('preferredProjection'), asNodeId('otherProjection')],
        {
          preferredScopePrefix: 'module.jobs["abi"]',
          preferredInstanceKey: 'abi-blue',
          rawTargetNodeId: rawTargetId,
          confidence: 'structural',
        },
      ),
    ).toStrictEqual({
      projectionId: 'preferredProjection',
      confidence: 'structural',
    });

    const tiedGraph = createMockGraph(
      {
        [scheduleProjectionId]: graph.getNodeAttributes(scheduleProjectionId),
        first: {
          projection: {
            derivation: {
              rootNodeId: asNodeId('root-a'),
            },
          },
        },
        second: {
          projection: {
            derivation: {
              rootNodeId: asNodeId('root-b'),
            },
          },
        },
        [asNodeId('root-a')]: { terraform: { resource: 'aws_lambda_function' } },
        [asNodeId('root-b')]: { terraform: { resource: 'aws_lambda_function' } },
      },
      [],
    );
    expect(
      __testing.selectBestProjectionTarget(
        tiedGraph,
        scheduleProjectionId,
        [asNodeId('first'), asNodeId('second')],
        {
          confidence: 'heuristic',
        },
      ),
    ).toBeUndefined();

    const scopeCandidate: SemanticReferenceCandidate = {
      kind: 'scope',
      reference: 'module.jobs',
      confidence: 'structural',
      score: 80,
      reason: 'scope',
      addressPrefix: 'module.jobs',
    };
    const moduleNodeCandidate: SemanticReferenceCandidate = {
      kind: 'node',
      reference: 'module.jobs',
      confidence: 'heuristic',
      score: 90,
      reason: 'module',
      nodeId: asNodeId('moduleNode'),
      address: 'module.jobs',
    };
    const resourceNodeCandidate: SemanticReferenceCandidate = {
      kind: 'node',
      reference: 'aws_lambda_function.fn',
      confidence: 'exact',
      score: 90,
      reason: 'node',
      nodeId: asNodeId('resourceNode'),
      address: 'aws_lambda_function.fn',
    };

    expect(__testing.selectBestScheduleReferenceCandidate(graph, [])).toBeUndefined();
    expect(
      __testing.selectBestScheduleReferenceCandidate(graph, [resourceNodeCandidate]),
    ).toStrictEqual(resourceNodeCandidate);
    expect(
      __testing.selectBestScheduleReferenceCandidate(graph, [moduleNodeCandidate, scopeCandidate]),
    ).toStrictEqual(scopeCandidate);
  });

  it('should cover project fallback branches', () => {
    const rawScheduleId = asNodeId('raw-schedule');
    const rawTargetId = asNodeId('raw-target');
    const rawWrongRootId = asNodeId('raw-wrong-root');
    const scheduleProjectionId = asNodeId('projection-schedule');
    const targetProjectionId = asNodeId('projection-target');
    const ambiguousTargetProjectionId = asNodeId('projection-target-2');

    let adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [rawScheduleId]: {
          id: rawScheduleId,
          terraform: {
            kind: 'resource',
            address: 'aws_scheduler_schedule.example',
            resource: 'aws_scheduler_schedule',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_scheduler_schedule.example',
                values: {},
              },
              instances: [],
            },
          },
        },
        [rawTargetId]: {
          id: rawTargetId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.fn',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_lambda_function.fn',
                values: {},
              },
              instances: [],
            },
          },
        },
        [rawWrongRootId]: {
          id: rawWrongRootId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.wrong_root',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_lambda_function.wrong_root',
                values: {},
              },
              instances: [],
            },
          },
        },
        projectionWithoutRoot: {
          id: asNodeId('projection-without-root'),
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_schedule:missing',
            label: 'missing',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.eventbridge_schedule',
            },
          },
        },
        projectionWrongRoot: {
          id: asNodeId('projection-wrong-root'),
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_schedule:wrong-root',
            label: 'wrong-root',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.eventbridge_schedule',
              rootNodeId: rawWrongRootId,
            },
          },
        },
        projectionExisting: {
          id: asNodeId('projection-existing'),
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_schedule:existing',
            label: 'existing',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.eventbridge_schedule',
              rootNodeId: rawScheduleId,
            },
          },
        },
        [scheduleProjectionId]: {
          id: scheduleProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.eventbridge_schedule:example',
            label: 'example',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.eventbridge_schedule',
              rootNodeId: rawScheduleId,
            },
          },
        },
        [targetProjectionId]: {
          id: targetProjectionId,
          projection: {
            layer: 'core',
            address: 'aws.lambda:fn',
            label: 'fn',
            derivation: {
              source: 'plugin',
              projectionName: 'aws.lambda',
              rootNodeId: rawTargetId,
            },
          },
        },
      },
      edges: [
        {
          id: asEdgeId('existing-projected-fact'),
          from: asNodeId('projection-existing'),
          to: targetProjectionId,
          attributes: {
            projection: {
              layer: 'core',
              semantics: {
                facts: [
                  {
                    kind: 'schedules',
                    from: asNodeId('projection-existing'),
                    to: targetProjectionId,
                    source: 'explicit_connection',
                    confidence: 'exact',
                    decorator: AwsScheduleSemanticDecorator.id,
                  },
                ],
              },
            },
          },
        },
        {
          id: asEdgeId('empty-existing-edge'),
          from: scheduleProjectionId,
          to: targetProjectionId,
          attributes: {
            projection: {
              layer: 'core',
            },
          },
        },
      ],
    });

    adapter = setNodeSemanticContext(adapter, rawScheduleId, AwsScheduleSemanticDecorator.id, {
      exactTargetNodeId: rawTargetId,
      targetReferences: ['missing.reference'],
      moduleReferences: [],
    });

    const projected = new AwsScheduleSemanticDecorator().project({ graph: adapter });
    expect(
      projected.getEdgeAttributes(asEdgeId('empty-existing-edge'))?.projection?.semantics
        ?.facts?.[0],
    ).toMatchObject({
      kind: 'schedules',
      from: scheduleProjectionId,
      to: targetProjectionId,
    });

    const ambiguousAdapter = setNodeSemanticContext(
      buildAdapter({
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [rawScheduleId]: {
            id: rawScheduleId,
            terraform: {
              kind: 'resource',
              address: 'aws_scheduler_schedule.example',
              resource: 'aws_scheduler_schedule',
              state: {
                source: 'plan_show',
                effective: {
                  address: 'aws_scheduler_schedule.example',
                  values: {},
                },
                instances: [],
              },
            },
          },
          [rawTargetId]: {
            id: rawTargetId,
            terraform: {
              kind: 'resource',
              address: 'aws_lambda_function.fn',
              resource: 'aws_lambda_function',
              state: {
                source: 'plan_show',
                effective: {
                  address: 'aws_lambda_function.fn',
                  values: {},
                },
                instances: [],
              },
            },
          },
          [scheduleProjectionId]: {
            id: scheduleProjectionId,
            projection: {
              layer: 'core',
              address: 'aws.eventbridge_schedule:example',
              label: 'example',
              derivation: {
                source: 'plugin',
                projectionName: 'aws.eventbridge_schedule',
                rootNodeId: rawScheduleId,
              },
            },
          },
          [targetProjectionId]: {
            id: targetProjectionId,
            projection: {
              layer: 'core',
              address: 'aws.lambda:fn',
              label: 'fn',
              derivation: {
                source: 'plugin',
                projectionName: 'aws.lambda',
                rootNodeId: rawTargetId,
              },
            },
          },
          [ambiguousTargetProjectionId]: {
            id: ambiguousTargetProjectionId,
            projection: {
              layer: 'core',
              address: 'aws.lambda:fn-2',
              label: 'fn-2',
              derivation: {
                source: 'plugin',
                projectionName: 'aws.lambda',
                rootNodeId: rawTargetId,
              },
            },
          },
        },
        edges: [],
      }),
      rawScheduleId,
      AwsScheduleSemanticDecorator.id,
      {
        exactTargetNodeId: rawTargetId,
      },
    );
    const ambiguousProjected = new AwsScheduleSemanticDecorator().project({
      graph: ambiguousAdapter,
    });
    expect(
      ambiguousProjected
        .outEdges(scheduleProjectionId)
        .filter((edgeId) =>
          ambiguousProjected
            .getEdgeAttributes(edgeId)
            ?.projection?.semantics?.facts?.some(
              (fact) => fact.decorator === AwsScheduleSemanticDecorator.id,
            ),
        ),
    ).toHaveLength(0);
  });

  it('should resolve extract fallbacks through lambda names and node references', () => {
    const scheduleId = asNodeId('schedule');
    const lambdaId = asNodeId('lambda');
    const queueId = asNodeId('queue');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [scheduleId]: {
          id: scheduleId,
          terraform: {
            kind: 'resource',
            address: 'aws_scheduler_schedule.example',
            resource: 'aws_scheduler_schedule',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_scheduler_schedule.example',
                values: {
                  target: [
                    { arn: 'arn:aws:lambda:eu-west-2:123456789012:function:event-flow' },
                    { arn: 'aws_sqs_queue.queue' },
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
            address: 'aws_lambda_function.fn',
            resource: 'aws_lambda_function',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_lambda_function.fn',
                values: {
                  function_name: 'event-flow',
                },
              },
              instances: [],
            },
          },
        },
        [queueId]: {
          id: queueId,
          terraform: {
            kind: 'resource',
            address: 'aws_sqs_queue.queue',
            resource: 'aws_sqs_queue',
            state: {
              source: 'plan_show',
              effective: {
                address: 'aws_sqs_queue.queue',
                values: {},
              },
              instances: [],
            },
          },
        },
      },
      edges: [],
    });
    const originalNodeIds = adapter.nodeIds.bind(adapter);
    const originalGetNodeAttributes = adapter.getNodeAttributes.bind(adapter);
    jest
      .spyOn(adapter, 'nodeIds')
      .mockImplementation(() => [...originalNodeIds(), asNodeId('ghost')]);
    jest.spyOn(adapter, 'getNodeAttributes').mockImplementation((nodeId) => {
      if (nodeId === asNodeId('ghost')) {
        return undefined;
      }
      return originalGetNodeAttributes(nodeId);
    });

    const extracted = new AwsScheduleSemanticDecorator().extract({ graph: adapter });
    const semanticEdges = extracted
      .outEdges(scheduleId)
      .filter((edgeId) =>
        extracted
          .getEdgeAttributes(edgeId)
          ?.semantic?.facts?.some((fact) => fact.decorator === AwsScheduleSemanticDecorator.id),
      );

    expect(semanticEdges).toHaveLength(1);
    expect(extracted.edgeTarget(semanticEdges[0])).toBe(lambdaId);
  });
});
