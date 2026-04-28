import {
  type AdapterOperations,
  type BaseRule,
  GraphologyAdapter,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import networkSemanticsRuleSet from './network.js';

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

const applyRules = (graph: TgGraph): AdapterOperations => {
  const rules = networkSemanticsRuleSet.resolvePhases()[0] ?? [];
  let updated = buildAdapter(graph);

  for (const rule of rules) {
    updated = applyRuleAcrossNodes(rule, updated);
  }

  return updated;
};

describe('networkSemanticsRuleSet', () => {
  it('shoud route alb request paths through listener and target group to ecs services', () => {
    const loadBalancerId = asNodeId('resource.aws_lb.this');
    const listenerId = asNodeId('resource.aws_lb_listener.http');
    const targetGroupId = asNodeId('resource.aws_lb_target_group.service');
    const ecsServiceId = asNodeId('resource.aws_ecs_service.app');

    const updated = applyRules({
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
    });

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

  it('shoud reinterpret target groups as routing to autoscaling groups via enforceDirection', () => {
    const targetGroupId = asNodeId('resource.aws_lb_target_group.app');
    const asgId = asNodeId('resource.aws_autoscaling_group.app');
    const edgeId = asEdgeId('asg-target-group');

    const updated = applyRules({
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
    });

    expect(updated.edgeSource(edgeId)).toBe(targetGroupId);
    expect(updated.edgeTarget(edgeId)).toBe(asgId);
    expect(updated.getEdgeAttributes(edgeId)?.directionSemantic).toBe('routes');
  });

  it('shoud reinterpret route tables as routing through route entries to gateways and endpoints', () => {
    const associationId = asNodeId('resource.aws_route_table_association.public_a');
    const routeTableId = asNodeId('resource.aws_route_table.public');
    const routeToIgwId = asNodeId('resource.aws_route.internet_access');
    const routeToNatId = asNodeId('resource.aws_route.private_nat');
    const routeToEndpointId = asNodeId('resource.aws_route.private_endpoint');
    const internetGatewayId = asNodeId('resource.aws_internet_gateway.this');
    const natGatewayId = asNodeId('resource.aws_nat_gateway.this');
    const endpointId = asNodeId('resource.aws_vpc_endpoint.s3');

    const updated = applyRules({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [associationId]: {
          id: associationId,
          terraform: {
            kind: 'resource',
            address: 'aws_route_table_association.public_a',
            resource: 'aws_route_table_association',
            name: 'public_a',
          },
        },
        [routeTableId]: {
          id: routeTableId,
          terraform: {
            kind: 'resource',
            address: 'aws_route_table.public',
            resource: 'aws_route_table',
            name: 'public',
          },
        },
        [routeToIgwId]: {
          id: routeToIgwId,
          terraform: {
            kind: 'resource',
            address: 'aws_route.internet_access',
            resource: 'aws_route',
            name: 'internet_access',
          },
        },
        [routeToNatId]: {
          id: routeToNatId,
          terraform: {
            kind: 'resource',
            address: 'aws_route.private_nat',
            resource: 'aws_route',
            name: 'private_nat',
          },
        },
        [routeToEndpointId]: {
          id: routeToEndpointId,
          terraform: {
            kind: 'resource',
            address: 'aws_route.private_endpoint',
            resource: 'aws_route',
            name: 'private_endpoint',
          },
        },
        [internetGatewayId]: {
          id: internetGatewayId,
          terraform: {
            kind: 'resource',
            address: 'aws_internet_gateway.this',
            resource: 'aws_internet_gateway',
            name: 'this',
          },
        },
        [natGatewayId]: {
          id: natGatewayId,
          terraform: {
            kind: 'resource',
            address: 'aws_nat_gateway.this',
            resource: 'aws_nat_gateway',
            name: 'this',
          },
        },
        [endpointId]: {
          id: endpointId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc_endpoint.s3',
            resource: 'aws_vpc_endpoint',
            name: 's3',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('association-route-table'),
          from: associationId,
          to: routeTableId,
          attributes: {},
        },
        {
          id: asEdgeId('route-igw-route-table'),
          from: routeToIgwId,
          to: routeTableId,
          attributes: {},
        },
        {
          id: asEdgeId('route-nat-route-table'),
          from: routeToNatId,
          to: routeTableId,
          attributes: {},
        },
        {
          id: asEdgeId('route-endpoint-route-table'),
          from: routeToEndpointId,
          to: routeTableId,
          attributes: {},
        },
        {
          id: asEdgeId('route-igw'),
          from: routeToIgwId,
          to: internetGatewayId,
          attributes: {},
        },
        {
          id: asEdgeId('route-nat'),
          from: routeToNatId,
          to: natGatewayId,
          attributes: {},
        },
        {
          id: asEdgeId('route-endpoint'),
          from: routeToEndpointId,
          to: endpointId,
          attributes: {},
        },
      ],
    });

    expect(updated.getEdgeAttributes(asEdgeId('association-route-table'))?.directionSemantic).toBe(
      'routes',
    );
    expect(updated.edgeSource(asEdgeId('route-igw-route-table'))).toBe(routeTableId);
    expect(updated.edgeTarget(asEdgeId('route-igw-route-table'))).toBe(routeToIgwId);
    expect(updated.getEdgeAttributes(asEdgeId('route-igw-route-table'))?.directionSemantic).toBe(
      'routes',
    );
    expect(updated.edgeSource(asEdgeId('route-nat-route-table'))).toBe(routeTableId);
    expect(updated.edgeTarget(asEdgeId('route-nat-route-table'))).toBe(routeToNatId);
    expect(updated.getEdgeAttributes(asEdgeId('route-nat'))?.directionSemantic).toBe('routes');
    expect(updated.getEdgeAttributes(asEdgeId('route-endpoint'))?.directionSemantic).toBe(
      'routes',
    );
  });

  it('shoud mark security group ingress and egress rules as authorizes', () => {
    const securityGroupId = asNodeId('resource.aws_security_group.app');
    const ingressRuleId = asNodeId('resource.aws_vpc_security_group_ingress_rule.http');
    const egressRuleId = asNodeId('resource.aws_vpc_security_group_egress_rule.outbound');

    const updated = applyRules({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [securityGroupId]: {
          id: securityGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.app',
            resource: 'aws_security_group',
            name: 'app',
          },
        },
        [ingressRuleId]: {
          id: ingressRuleId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc_security_group_ingress_rule.http',
            resource: 'aws_vpc_security_group_ingress_rule',
            name: 'http',
          },
        },
        [egressRuleId]: {
          id: egressRuleId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc_security_group_egress_rule.outbound',
            resource: 'aws_vpc_security_group_egress_rule',
            name: 'outbound',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('ingress-sg'),
          from: ingressRuleId,
          to: securityGroupId,
          attributes: {},
        },
        {
          id: asEdgeId('egress-sg'),
          from: egressRuleId,
          to: securityGroupId,
          attributes: {},
        },
      ],
    });

    expect(updated.getEdgeAttributes(asEdgeId('ingress-sg'))?.directionSemantic).toBe(
      'authorizes',
    );
    expect(updated.getEdgeAttributes(asEdgeId('egress-sg'))?.directionSemantic).toBe(
      'authorizes',
    );
  });

  it('shoud reinterpret security group attachments as authorizes on the protected resource', () => {
    const securityGroupId = asNodeId('resource.aws_security_group.db');
    const rdsClusterId = asNodeId('resource.aws_rds_cluster.this');
    const edgeId = asEdgeId('rds-sg');

    const updated = applyRules({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [securityGroupId]: {
          id: securityGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.db',
            resource: 'aws_security_group',
            name: 'db',
          },
        },
        [rdsClusterId]: {
          id: rdsClusterId,
          terraform: {
            kind: 'resource',
            address: 'aws_rds_cluster.this',
            resource: 'aws_rds_cluster',
            name: 'this',
          },
        },
      },
      edges: [
        {
          id: edgeId,
          from: rdsClusterId,
          to: securityGroupId,
          attributes: {},
        },
      ],
    });

    expect(updated.edgeSource(edgeId)).toBe(securityGroupId);
    expect(updated.edgeTarget(edgeId)).toBe(rdsClusterId);
    expect(updated.getEdgeAttributes(edgeId)?.directionSemantic).toBe(
      'authorizes',
    );
  });

  it('should not mark structural security group edges as authorizes', () => {
    const securityGroupId = asNodeId('resource.aws_security_group.app');
    const vpcId = asNodeId('resource.aws_vpc.this');
    const peerSecurityGroupId = asNodeId('resource.aws_security_group.peer');

    const updated = applyRules({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [securityGroupId]: {
          id: securityGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.app',
            resource: 'aws_security_group',
            name: 'app',
          },
        },
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.this',
            resource: 'aws_vpc',
            name: 'this',
          },
        },
        [peerSecurityGroupId]: {
          id: peerSecurityGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.peer',
            resource: 'aws_security_group',
            name: 'peer',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('sg-vpc'),
          from: securityGroupId,
          to: vpcId,
          attributes: {},
        },
        {
          id: asEdgeId('sg-sg'),
          from: securityGroupId,
          to: peerSecurityGroupId,
          attributes: {},
        },
      ],
    });

    expect(updated.getEdgeAttributes(asEdgeId('sg-vpc'))?.directionSemantic).toBeUndefined();
    expect(updated.getEdgeAttributes(asEdgeId('sg-sg'))?.directionSemantic).toBeUndefined();
  });
});
