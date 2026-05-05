import {
  type AdapterOperations,
  type BaseRule,
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import ecsSemanticsRuleSet, { ecsCleanupRuleSet } from './ecs.js';

const buildAdapter = (graph: TgGraph): AdapterOperations => {
  return new GraphologyAdapter().withTgGraph(graph);
};

const applyRuleAcrossNodes = (rule: BaseRule, adapter: AdapterOperations): AdapterOperations => {
  let updated = adapter;

  for (const nodeId of updated.nodeIds()) {
    const node = updated.getNodeAttributes(nodeId);
    if (!node) {
      continue;
    }

    rule.match(nodeId, node, updated);
    updated = rule.apply(nodeId, node, updated);
  }

  return updated;
};

const applyRuleSet = (ruleSet: typeof ecsSemanticsRuleSet, graph: TgGraph) => {
  const phases = ruleSet.resolvePhases();
  let adapter = buildAdapter(graph);

  for (const phase of phases) {
    for (const nodeId of adapter.nodeIds()) {
      const node = adapter.getNodeAttributes(nodeId);
      if (!node) {
        continue;
      }

      for (const rule of phase) {
        rule.match(nodeId, node, adapter);
        adapter = rule.apply(nodeId, node, adapter);
      }
    }
  }

  return adapter;
};

describe('ecs dataflow rulesets', () => {
  it('shoud apply ecs invokes, publishes, and accesses semantics', () => {
    const serviceId = asNodeId('resource.aws_ecs_service.app');
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.app');
    const topicId = asNodeId('resource.aws_sns_topic.events');
    const tableId = asNodeId('resource.aws_dynamodb_table.data');

    const adapter = applyRuleSet(ecsSemanticsRuleSet, {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [serviceId]: {
          id: serviceId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_service.app',
            resource: 'aws_ecs_service',
            name: 'app',
          },
        },
        [taskDefinitionId]: {
          id: taskDefinitionId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_task_definition.app',
            resource: 'aws_ecs_task_definition',
            name: 'app',
          },
        },
        [topicId]: {
          id: topicId,
          terraform: {
            kind: 'resource',
            address: 'aws_sns_topic.events',
            resource: 'aws_sns_topic',
            name: 'events',
          },
        },
        [tableId]: {
          id: tableId,
          terraform: {
            kind: 'resource',
            address: 'aws_dynamodb_table.data',
            resource: 'aws_dynamodb_table',
            name: 'data',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-service-task-definition'),
          from: serviceId,
          to: taskDefinitionId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-service-topic'),
          from: serviceId,
          to: topicId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-service-table'),
          from: serviceId,
          to: tableId,
          attributes: {},
        },
      ],
    });

    expect(adapter.getEdgeAttributes(asEdgeId('edge-service-task-definition')).hints?.semantic?.semantic).toBe(
      'invokes',
    );
    expect(adapter.getEdgeAttributes(asEdgeId('edge-service-topic')).hints?.semantic?.semantic).toBe(
      'publishes',
    );
    expect(adapter.getEdgeAttributes(asEdgeId('edge-service-table')).hints?.semantic?.semantic).toBe(
      'accesses',
    );
  });

  it('shoud remove ecs cluster nodes during cleanup and keep task definitions', () => {
    const [rule] = ecsCleanupRuleSet.resolvePhases()[0] ?? [];
    if (!rule) {
      throw new Error('Expected cleanup rule');
    }

    const clusterId = asNodeId('resource.aws_ecs_cluster.main');
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.app');
    const serviceId = asNodeId('resource.aws_ecs_service.app');

    const adapter = applyRuleAcrossNodes(
      rule,
      buildAdapter({
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [clusterId]: {
            id: clusterId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_cluster.main',
              resource: 'aws_ecs_cluster',
              name: 'main',
            },
          },
          [taskDefinitionId]: {
            id: taskDefinitionId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_task_definition.app',
              resource: 'aws_ecs_task_definition',
              name: 'app',
            },
          },
          [serviceId]: {
            id: serviceId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_service.app',
              resource: 'aws_ecs_service',
              name: 'app',
            },
          },
        },
        edges: [
          {
            id: asEdgeId('edge-service-cluster'),
            from: serviceId,
            to: clusterId,
            attributes: {},
          },
          {
            id: asEdgeId('edge-service-task-definition'),
            from: serviceId,
            to: taskDefinitionId,
            attributes: {},
          },
        ],
      }),
    );

    expect(adapter.getNodeAttributes(clusterId)).toBeUndefined();
    expect(adapter.getNodeAttributes(taskDefinitionId)).toBeDefined();
    expect(adapter.getNodeAttributes(serviceId)).toBeDefined();
    expect(adapter.outEdges(serviceId)).toHaveLength(1);
    expect(adapter.getEdgeAttributes(asEdgeId('edge-service-task-definition'))).toEqual({});
  });
});
