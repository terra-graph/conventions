import {
  type AdapterOperations,
  type BaseRule,
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import albSemanticsRuleSet, { albCleanupRuleSet } from './alb.js';

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

const applyRules = (graph: TgGraph, rules: BaseRule[]): AdapterOperations => {
  let updated = buildAdapter(graph);

  for (const rule of rules) {
    updated = applyRuleAcrossNodes(rule, updated);
  }

  return updated;
};

describe('albSemanticsRuleSet', () => {
  it('shoud route alb request paths through listener and target group to ecs services', () => {
    const loadBalancerId = asNodeId('resource.aws_lb.this');
    const listenerId = asNodeId('resource.aws_lb_listener.http');
    const targetGroupId = asNodeId('resource.aws_lb_target_group.service');
    const ecsServiceId = asNodeId('resource.aws_ecs_service.app');

    const updated = applyRules(
      {
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [loadBalancerId]: {
            id: loadBalancerId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb.this',
              resource: 'aws_lb',
              name: 'this',
            },
          },
          [listenerId]: {
            id: listenerId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_listener.http',
              resource: 'aws_lb_listener',
              name: 'http',
            },
          },
          [targetGroupId]: {
            id: targetGroupId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_target_group.service',
              resource: 'aws_lb_target_group',
              name: 'service',
            },
          },
          [ecsServiceId]: {
            id: ecsServiceId,
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
            id: asEdgeId('lb-listener'),
            from: loadBalancerId,
            to: listenerId,
            attributes: {},
          },
          {
            id: asEdgeId('listener-target-group'),
            from: listenerId,
            to: targetGroupId,
            attributes: {},
          },
          {
            id: asEdgeId('listener-service'),
            from: listenerId,
            to: ecsServiceId,
            attributes: {},
          },
          {
            id: asEdgeId('target-group-service'),
            from: targetGroupId,
            to: ecsServiceId,
            attributes: {},
          },
        ],
      },
      albSemanticsRuleSet.resolvePhases()[0] ?? [],
    );

    expect(updated.getEdgeAttributes(asEdgeId('lb-listener'))?.directionSemantic).toBe('routes');
    expect(updated.getEdgeAttributes(asEdgeId('listener-target-group'))?.directionSemantic).toBe(
      'routes',
    );
    expect(updated.getEdgeAttributes(asEdgeId('listener-service'))?.directionSemantic).toBe(
      'routes',
    );
    expect(updated.getEdgeAttributes(asEdgeId('target-group-service'))?.directionSemantic).toBe(
      'routes',
    );
  });

  it('shoud route load balancers directly to ecs services after cleanup collapse', () => {
    const loadBalancerId = asNodeId('resource.aws_lb.this');
    const ecsServiceId = asNodeId('resource.aws_ecs_service.app');
    const edgeId = asEdgeId('lb-service');

    const updated = applyRules(
      {
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [loadBalancerId]: {
            id: loadBalancerId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb.this',
              resource: 'aws_lb',
              name: 'this',
            },
          },
          [ecsServiceId]: {
            id: ecsServiceId,
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
            id: edgeId,
            from: loadBalancerId,
            to: ecsServiceId,
            attributes: {},
          },
        ],
      },
      albSemanticsRuleSet.resolvePhases()[0] ?? [],
    );

    expect(updated.edgeSource(edgeId)).toBe(loadBalancerId);
    expect(updated.edgeTarget(edgeId)).toBe(ecsServiceId);
    expect(updated.getEdgeAttributes(edgeId)?.directionSemantic).toBe('routes');
  });

  it('shoud reinterpret target groups as routing to autoscaling groups via enforceDirection', () => {
    const targetGroupId = asNodeId('resource.aws_lb_target_group.app');
    const asgId = asNodeId('resource.aws_autoscaling_group.app');
    const edgeId = asEdgeId('asg-target-group');

    const updated = applyRules(
      {
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [targetGroupId]: {
            id: targetGroupId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_target_group.app',
              resource: 'aws_lb_target_group',
              name: 'app',
            },
          },
          [asgId]: {
            id: asgId,
            terraform: {
              kind: 'resource',
              address: 'aws_autoscaling_group.app',
              resource: 'aws_autoscaling_group',
              name: 'app',
            },
          },
        },
        edges: [
          {
            id: edgeId,
            from: asgId,
            to: targetGroupId,
            attributes: {},
          },
        ],
      },
      albSemanticsRuleSet.resolvePhases()[0] ?? [],
    );

    expect(updated.edgeSource(edgeId)).toBe(targetGroupId);
    expect(updated.edgeTarget(edgeId)).toBe(asgId);
    expect(updated.getEdgeAttributes(edgeId)?.directionSemantic).toBe('routes');
  });
});

describe('albCleanupRuleSet', () => {
  it('shoud collapse listener and target group nodes into a direct lb to ecs service route', () => {
    const loadBalancerId = asNodeId('resource.aws_lb.this');
    const listenerId = asNodeId('resource.aws_lb_listener.http');
    const targetGroupId = asNodeId('resource.aws_lb_target_group.service');
    const ecsServiceId = asNodeId('resource.aws_ecs_service.app');

    const updated = applyRules(
      {
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [loadBalancerId]: {
            id: loadBalancerId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb.this',
              resource: 'aws_lb',
              name: 'this',
            },
          },
          [listenerId]: {
            id: listenerId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_listener.http',
              resource: 'aws_lb_listener',
              name: 'http',
            },
          },
          [targetGroupId]: {
            id: targetGroupId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_target_group.service',
              resource: 'aws_lb_target_group',
              name: 'service',
            },
          },
          [ecsServiceId]: {
            id: ecsServiceId,
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
            id: asEdgeId('lb-listener'),
            from: loadBalancerId,
            to: listenerId,
            attributes: {},
          },
          {
            id: asEdgeId('listener-target-group'),
            from: listenerId,
            to: targetGroupId,
            attributes: {},
          },
          {
            id: asEdgeId('target-group-service'),
            from: targetGroupId,
            to: ecsServiceId,
            attributes: {},
          },
        ],
      },
      albCleanupRuleSet.resolvePhases()[0] ?? [],
    );

    expect(updated.getNodeAttributes(listenerId)).toBeUndefined();
    expect(updated.getNodeAttributes(targetGroupId)).toBeUndefined();
    const directEdgeId = updated
      .outEdges(loadBalancerId)
      .find((edgeId) => updated.edgeTarget(edgeId) === ecsServiceId);
    expect(directEdgeId).toBeDefined();
    expect(updated.getEdgeAttributes(directEdgeId!)?.directionSemantic).toBe('routes');
  });

  it('shoud collapse cloned listener and target group chains without cross-subnet lb routes', () => {
    const loadBalancerAId = asNodeId('resource.aws_lb.this');
    const listenerAId = asNodeId('resource.aws_lb_listener.http');
    const targetGroupAId = asNodeId('resource.aws_lb_target_group.service');
    const serviceAId = asNodeId('resource.aws_ecs_service.app');

    const loadBalancerBId = asNodeId('resource.aws_lb.this:replica:subnet:public_b');
    const listenerBId = asNodeId('resource.aws_lb_listener.http:replica:subnet:public_b');
    const targetGroupBId = asNodeId('resource.aws_lb_target_group.service:replica:subnet:public_b');
    const serviceBId = asNodeId('resource.aws_ecs_service.app:replica:subnet:public_b');

    const updated = applyRules(
      {
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [loadBalancerAId]: {
            id: loadBalancerAId,
            terraform: { kind: 'resource', address: 'aws_lb.this', resource: 'aws_lb', name: 'this' },
          },
          [listenerAId]: {
            id: listenerAId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_listener.http',
              resource: 'aws_lb_listener',
              name: 'http',
            },
          },
          [targetGroupAId]: {
            id: targetGroupAId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_target_group.service',
              resource: 'aws_lb_target_group',
              name: 'service',
            },
          },
          [serviceAId]: {
            id: serviceAId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_service.app',
              resource: 'aws_ecs_service',
              name: 'app',
            },
          },
          [loadBalancerBId]: {
            id: loadBalancerBId,
            terraform: { kind: 'resource', address: 'aws_lb.this', resource: 'aws_lb', name: 'this' },
          },
          [listenerBId]: {
            id: listenerBId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_listener.http',
              resource: 'aws_lb_listener',
              name: 'http',
            },
          },
          [targetGroupBId]: {
            id: targetGroupBId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_target_group.service',
              resource: 'aws_lb_target_group',
              name: 'service',
            },
          },
          [serviceBId]: {
            id: serviceBId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_service.app',
              resource: 'aws_ecs_service',
              name: 'app',
            },
          },
        },
        edges: [
          { id: asEdgeId('lb-a-listener-a'), from: loadBalancerAId, to: listenerAId, attributes: {} },
          { id: asEdgeId('listener-a-tg-a'), from: listenerAId, to: targetGroupAId, attributes: {} },
          { id: asEdgeId('tg-a-service-a'), from: targetGroupAId, to: serviceAId, attributes: {} },
          { id: asEdgeId('lb-b-listener-b'), from: loadBalancerBId, to: listenerBId, attributes: {} },
          { id: asEdgeId('listener-b-tg-b'), from: listenerBId, to: targetGroupBId, attributes: {} },
          { id: asEdgeId('tg-b-service-b'), from: targetGroupBId, to: serviceBId, attributes: {} },
        ],
      },
      albCleanupRuleSet.resolvePhases()[0] ?? [],
    );

    expect(updated.getNodeAttributes(listenerAId)).toBeUndefined();
    expect(updated.getNodeAttributes(targetGroupAId)).toBeUndefined();
    expect(updated.getNodeAttributes(listenerBId)).toBeUndefined();
    expect(updated.getNodeAttributes(targetGroupBId)).toBeUndefined();

    expect(updated.outEdges(loadBalancerAId).some((edgeId) => updated.edgeTarget(edgeId) === serviceAId)).toBe(true);
    expect(updated.outEdges(loadBalancerBId).some((edgeId) => updated.edgeTarget(edgeId) === serviceBId)).toBe(true);
    expect(updated.outEdges(loadBalancerAId).some((edgeId) => updated.edgeTarget(edgeId) === serviceBId)).toBe(false);
    expect(updated.outEdges(loadBalancerBId).some((edgeId) => updated.edgeTarget(edgeId) === serviceAId)).toBe(false);
  });

  it('shoud not cross-product shared intermediary nodes across different subnet scopes', () => {
    const loadBalancerAId = asNodeId('resource.aws_lb.this');
    const loadBalancerBId = asNodeId('resource.aws_lb.this:replica:subnet:public_b');
    const targetGroupId = asNodeId('resource.aws_lb_target_group.app');
    const serviceAId = asNodeId('resource.aws_ecs_service.app');
    const serviceBId = asNodeId('resource.aws_ecs_service.app:replica:subnet:public_b');

    const updated = applyRules(
      {
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [loadBalancerAId]: {
            id: loadBalancerAId,
            terraform: { kind: 'resource', address: 'aws_lb.this', resource: 'aws_lb', name: 'this' },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2a:subnet:public_a' } },
          },
          [loadBalancerBId]: {
            id: loadBalancerBId,
            terraform: { kind: 'resource', address: 'aws_lb.this', resource: 'aws_lb', name: 'this' },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2b:subnet:public_b' } },
          },
          [targetGroupId]: {
            id: targetGroupId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_target_group.app',
              resource: 'aws_lb_target_group',
              name: 'app',
            },
          },
          [serviceAId]: {
            id: serviceAId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_service.app',
              resource: 'aws_ecs_service',
              name: 'app',
            },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2a:subnet:public_a' } },
          },
          [serviceBId]: {
            id: serviceBId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_service.app',
              resource: 'aws_ecs_service',
              name: 'app',
            },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2b:subnet:public_b' } },
          },
        },
        edges: [
          { id: asEdgeId('lb-a-tg'), from: loadBalancerAId, to: targetGroupId, attributes: {} },
          { id: asEdgeId('lb-b-tg'), from: loadBalancerBId, to: targetGroupId, attributes: {} },
          { id: asEdgeId('tg-service-a'), from: targetGroupId, to: serviceAId, attributes: {} },
          { id: asEdgeId('tg-service-b'), from: targetGroupId, to: serviceBId, attributes: {} },
        ],
      },
      albCleanupRuleSet.resolvePhases()[0] ?? [],
    );

    expect(updated.getNodeAttributes(targetGroupId)).toBeUndefined();
    expect(updated.outEdges(loadBalancerAId).some((edgeId) => updated.edgeTarget(edgeId) === serviceAId)).toBe(true);
    expect(updated.outEdges(loadBalancerBId).some((edgeId) => updated.edgeTarget(edgeId) === serviceBId)).toBe(true);
    expect(updated.outEdges(loadBalancerAId).some((edgeId) => updated.edgeTarget(edgeId) === serviceBId)).toBe(false);
    expect(updated.outEdges(loadBalancerBId).some((edgeId) => updated.edgeTarget(edgeId) === serviceAId)).toBe(false);
  });

  it('shoud materialize replica lb routes from canonical alb paths even when only the original intermediary chain exists', () => {
    const loadBalancerAId = asNodeId('resource.aws_lb.this');
    const loadBalancerBId = asNodeId('resource.aws_lb.this:replica:subnet:public_b');
    const listenerId = asNodeId('resource.aws_lb_listener.http');
    const targetGroupId = asNodeId('resource.aws_lb_target_group.app');
    const serviceAId = asNodeId('resource.aws_ecs_service.app');
    const serviceBId = asNodeId('resource.aws_ecs_service.app:replica:subnet:public_b');

    const updated = applyRules(
      {
        schemaVersion: TG_SCHEMA_VERSION,
        description: {},
        nodes: {
          [loadBalancerAId]: {
            id: loadBalancerAId,
            terraform: { kind: 'resource', address: 'aws_lb.this', resource: 'aws_lb', name: 'this' },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2a:subnet:public_a' } },
          },
          [loadBalancerBId]: {
            id: loadBalancerBId,
            terraform: { kind: 'resource', address: 'aws_lb.this', resource: 'aws_lb', name: 'this' },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2b:subnet:public_b' } },
          },
          [listenerId]: {
            id: listenerId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_listener.http',
              resource: 'aws_lb_listener',
              name: 'http',
            },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2a:subnet:public_a' } },
          },
          [targetGroupId]: {
            id: targetGroupId,
            terraform: {
              kind: 'resource',
              address: 'aws_lb_target_group.app',
              resource: 'aws_lb_target_group',
              name: 'app',
            },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2a:subnet:public_a' } },
          },
          [serviceAId]: {
            id: serviceAId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_service.app',
              resource: 'aws_ecs_service',
              name: 'app',
            },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2a:subnet:public_a' } },
          },
          [serviceBId]: {
            id: serviceBId,
            terraform: {
              kind: 'resource',
              address: 'aws_ecs_service.app',
              resource: 'aws_ecs_service',
              name: 'app',
            },
            hints: { topology: { scopeId: 'vpc:this:az:eu-west-2b:subnet:public_b' } },
          },
        },
        edges: [
          { id: asEdgeId('lb-a-listener'), from: loadBalancerAId, to: listenerId, attributes: {} },
          { id: asEdgeId('listener-tg'), from: listenerId, to: targetGroupId, attributes: {} },
          { id: asEdgeId('tg-service-a'), from: targetGroupId, to: serviceAId, attributes: {} },
        ],
      },
      albCleanupRuleSet.resolvePhases()[0] ?? [],
    );

    expect(updated.outEdges(loadBalancerAId).some((edgeId) => updated.edgeTarget(edgeId) === serviceAId)).toBe(true);
    expect(updated.outEdges(loadBalancerBId).some((edgeId) => updated.edgeTarget(edgeId) === serviceBId)).toBe(true);
    expect(updated.outEdges(loadBalancerAId).some((edgeId) => updated.edgeTarget(edgeId) === serviceBId)).toBe(false);
    expect(updated.outEdges(loadBalancerBId).some((edgeId) => updated.edgeTarget(edgeId) === serviceAId)).toBe(false);
  });
});
