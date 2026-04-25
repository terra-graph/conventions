import {
  type AdapterOperations,
  type BaseRule,
  type GraphPluginBuildInput,
  GraphologyAdapter,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  TG_SCHEMA_VERSION,
  type TgGraph,
  type TgNodeAttributes,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { AwsNetworkPlacementPlugin } from './AwsNetworkPlacementPlugin.js';

const buildRules = (options: unknown = {}): BaseRule[] => {
  const plugin = new AwsNetworkPlacementPlugin();
  const result = plugin.build({
    options,
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput<Record<string, unknown>>);

  return (result.phases ?? []).flatMap((phase) => phase.rules as BaseRule[]);
};

const buildAdapter = (graph: TgGraph): AdapterOperations => {
  return new GraphologyAdapter().withTgGraph(graph);
};

const buildTerraformState = (address: string, values: Record<string, unknown>) => ({
  source: 'state_show' as const,
  effective: {
    address,
    values,
  },
  instances: [],
});

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

describe('AwsNetworkPlacementPlugin.build', () => {
  it('shoud build one main phase rule with empty enrichers by default', () => {
    const rules = buildRules();

    expect(rules).toHaveLength(1);
    expect(rules[0]?.serialize()).toStrictEqual({
      id: 'ApplyAwsNetworkPlacementHints',
      config: {
        node: {
          any: true,
        },
        options: {
          enrichers: [],
          mode: 'full',
        },
      },
    });
  });

  it('shoud keep only supported enrichers and ignore invalid shapes', () => {
    const [rule] = buildRules({
      enrichers: ['rds', 'unknown', 1],
      ignored: true,
    });

    expect(rule?.serialize()).toStrictEqual({
      id: 'ApplyAwsNetworkPlacementHints',
      config: {
        node: {
          any: true,
        },
        options: {
          enrichers: ['rds'],
          mode: 'full',
        },
      },
    });

    const [ruleWithInvalidShape] = buildRules({ enrichers: 'rds' });
    expect(ruleWithInvalidShape?.serialize()).toStrictEqual({
      id: 'ApplyAwsNetworkPlacementHints',
      config: {
        node: {
          any: true,
        },
        options: {
          enrichers: [],
          mode: 'full',
        },
      },
    });

    const [ruleWithNonObjectOptions] = buildRules(null);
    expect(ruleWithNonObjectOptions?.serialize()).toStrictEqual({
      id: 'ApplyAwsNetworkPlacementHints',
      config: {
        node: {
          any: true,
        },
        options: {
          enrichers: [],
          mode: 'full',
        },
      },
    });
  });

  it('shoud normalize supported enricher ids deterministically', () => {
    const [rule] = buildRules({
      enrichers: ['elasticache', 'rds', 'ecs', 'network', 'rds', 'unknown'],
    });

    expect(rule?.serialize()).toStrictEqual({
      id: 'ApplyAwsNetworkPlacementHints',
      config: {
        node: {
          any: true,
        },
        options: {
          enrichers: ['ecs', 'elasticache', 'network', 'rds'],
          mode: 'full',
        },
      },
    });
  });

  it('shoud normalize supported visibility modes and fallback to full for invalid values', () => {
    const [rule] = buildRules({
      enrichers: ['rds'],
      mode: 'minimal',
    });

    expect(rule?.serialize()).toStrictEqual({
      id: 'ApplyAwsNetworkPlacementHints',
      config: {
        node: {
          any: true,
        },
        options: {
          enrichers: ['rds'],
          mode: 'minimal',
        },
      },
    });

    const [ruleWithInvalidMode] = buildRules({
      enrichers: ['rds'],
      mode: 'invalid',
    });

    expect(ruleWithInvalidMode?.serialize()).toStrictEqual({
      id: 'ApplyAwsNetworkPlacementHints',
      config: {
        node: {
          any: true,
        },
        options: {
          enrichers: ['rds'],
          mode: 'full',
        },
      },
    });
  });

  it('shoud no-op when apply is invoked before matching', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const nodeId = asNodeId('resource.aws_instance.unmatched');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [nodeId]: {
          id: nodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.unmatched',
            resource: 'aws_instance',
            name: 'unmatched',
          },
        },
      },
      edges: [],
    });

    const node = adapter.getNodeAttributes(nodeId);
    if (!node) {
      throw new Error('Expected node');
    }

    expect(rule.apply(nodeId, node, adapter)).toBe(adapter);
  });
});

describe('AwsNetworkPlacementPlugin.ApplyAwsNetworkPlacementHints', () => {
  it('shoud place nodes from explicit vpc/subnet state values', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetAId = asNodeId('resource.aws_subnet.a');
    const subnetBId = asNodeId('resource.aws_subnet.b');
    const instanceId = asNodeId('resource.aws_instance.web');
    const loadBalancerId = asNodeId('resource.aws_lb.app');
    const igwId = asNodeId('resource.aws_internet_gateway.main');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', {
              id: 'vpc-1',
            }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a',
            resource: 'aws_subnet',
            name: 'a',
            state: buildTerraformState('aws_subnet.a', {
              id: 'subnet-1',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.b',
            resource: 'aws_subnet',
            name: 'b',
            state: buildTerraformState('aws_subnet.b', {
              id: 'subnet-2',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [instanceId]: {
          id: instanceId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.web',
            resource: 'aws_instance',
            name: 'web',
            state: buildTerraformState('aws_instance.web', {
              subnet_id: 'subnet-1',
            }),
          },
        },
        [loadBalancerId]: {
          id: loadBalancerId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb.app',
            resource: 'aws_lb',
            name: 'app',
            state: buildTerraformState('aws_lb.app', {
              subnet_ids: ['subnet-1', 'subnet-2'],
            }),
          },
        },
        [igwId]: {
          id: igwId,
          terraform: {
            kind: 'resource',
            address: 'aws_internet_gateway.main',
            resource: 'aws_internet_gateway',
            name: 'main',
            state: buildTerraformState('aws_internet_gateway.main', {
              vpc_id: 'vpc-1',
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(instanceId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-1:az:eu-west-2a:subnet:subnet-1',
        }),
      }),
    );
    expect(updated.getNodeAttributes(loadBalancerId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-1',
        }),
      }),
    );
    expect(updated.getNodeAttributes(igwId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-1',
        }),
      }),
    );
  });

  it('shoud place autoscaling groups from vpc_zone_identifier with edge fallback when omitted', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetAId = asNodeId('resource.aws_subnet.a');
    const subnetBId = asNodeId('resource.aws_subnet.b');
    const asgSingleId = asNodeId('resource.aws_autoscaling_group.single');
    const asgMultiId = asNodeId('resource.aws_autoscaling_group.multi');
    const asgFallbackId = asNodeId('resource.aws_autoscaling_group.fallback');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', {
              id: 'vpc-1',
            }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a',
            resource: 'aws_subnet',
            name: 'a',
            state: buildTerraformState('aws_subnet.a', {
              id: 'subnet-a',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.b',
            resource: 'aws_subnet',
            name: 'b',
            state: buildTerraformState('aws_subnet.b', {
              id: 'subnet-b',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [asgSingleId]: {
          id: asgSingleId,
          terraform: {
            kind: 'resource',
            address: 'aws_autoscaling_group.single',
            resource: 'aws_autoscaling_group',
            name: 'single',
            state: buildTerraformState('aws_autoscaling_group.single', {
              vpc_zone_identifier: ['subnet-a'],
            }),
          },
        },
        [asgMultiId]: {
          id: asgMultiId,
          terraform: {
            kind: 'resource',
            address: 'aws_autoscaling_group.multi',
            resource: 'aws_autoscaling_group',
            name: 'multi',
            state: buildTerraformState('aws_autoscaling_group.multi', {
              vpc_zone_identifier: ['subnet-a', 'subnet-b'],
            }),
          },
        },
        [asgFallbackId]: {
          id: asgFallbackId,
          terraform: {
            kind: 'resource',
            address: 'aws_autoscaling_group.fallback',
            resource: 'aws_autoscaling_group',
            name: 'fallback',
            state: buildTerraformState('aws_autoscaling_group.fallback', {}),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-asg-fallback-subnet-b'),
          from: asgFallbackId,
          to: subnetBId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(asgSingleId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-1:az:eu-west-2a:subnet:subnet-a',
    );
    expect(updated.getNodeAttributes(asgMultiId)?.hints?.topology?.scopeId).toBe('vpc:vpc-1');
    expect(updated.getNodeAttributes(asgFallbackId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-1:az:eu-west-2b:subnet:subnet-b',
    );
  });

  it('shoud use edge fallback and inferred references when state fields are missing', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.fallback');
    const subnetId = asNodeId('resource.aws_subnet.fallback');
    const instanceEdgeId = asNodeId('resource.aws_instance.edge');
    const instanceInferredId = asNodeId('resource.aws_instance.inferred');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.fallback',
            resource: 'aws_vpc',
            name: 'fallback',
            state: buildTerraformState('aws_vpc.fallback', {
              id: 'vpc-fallback',
            }),
          },
        },
        [subnetId]: {
          id: subnetId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.fallback',
            resource: 'aws_subnet',
            name: 'fallback',
            state: buildTerraformState('aws_subnet.fallback', {
              id: 'subnet-fallback',
              vpc_id: 'vpc-fallback',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [instanceEdgeId]: {
          id: instanceEdgeId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.edge',
            resource: 'aws_instance',
            name: 'edge',
            state: buildTerraformState('aws_instance.edge', {
              subnet_ids: 'invalid-shape',
            }),
          },
        },
        [instanceInferredId]: {
          id: instanceInferredId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.inferred',
            resource: 'aws_instance',
            name: 'inferred',
            state: buildTerraformState('aws_instance.inferred', {
              subnet_id: 'subnet-inferred',
              vpc_id: 'vpc-inferred',
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-instance-subnet'),
          from: instanceEdgeId,
          to: subnetId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(instanceEdgeId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-fallback:az:eu-west-2a:subnet:subnet-fallback',
        }),
      }),
    );
    expect(updated.getNodeAttributes(instanceInferredId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-inferred:az:unknown:subnet:subnet-inferred',
        }),
      }),
    );
  });

  it('shoud leave ambiguous cross-vpc subnet references unscoped', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcAId = asNodeId('resource.aws_vpc.a');
    const vpcBId = asNodeId('resource.aws_vpc.b');
    const subnetAId = asNodeId('resource.aws_subnet.a');
    const subnetBId = asNodeId('resource.aws_subnet.b');
    const crossVpcNodeId = asNodeId('resource.aws_lb.cross_vpc');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcAId]: {
          id: vpcAId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.a',
            resource: 'aws_vpc',
            name: 'a',
            state: buildTerraformState('aws_vpc.a', {
              id: 'vpc-a',
            }),
          },
        },
        [vpcBId]: {
          id: vpcBId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.b',
            resource: 'aws_vpc',
            name: 'b',
            state: buildTerraformState('aws_vpc.b', {
              id: 'vpc-b',
            }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a',
            resource: 'aws_subnet',
            name: 'a',
            state: buildTerraformState('aws_subnet.a', {
              id: 'subnet-a',
              vpc_id: 'vpc-a',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.b',
            resource: 'aws_subnet',
            name: 'b',
            state: buildTerraformState('aws_subnet.b', {
              id: 'subnet-b',
              vpc_id: 'vpc-b',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [crossVpcNodeId]: {
          id: crossVpcNodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb.cross_vpc',
            resource: 'aws_lb',
            name: 'cross_vpc',
            state: buildTerraformState('aws_lb.cross_vpc', {
              subnet_ids: ['subnet-a', 'subnet-b'],
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(crossVpcNodeId)?.hints?.topology).toBeUndefined();
  });

  it('shoud infer module-local subnet topology and fallback enricher-managed resources to a single vpc scope', () => {
    const [rule] = buildRules({ enrichers: ['rds', 'network'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.module.vpc.aws_vpc.this[0]');
    const subnetAId = asNodeId('resource.module.vpc.aws_subnet.private[0]');
    const subnetBId = asNodeId('resource.module.vpc.aws_subnet.private[1]');
    const dbSubnetGroupId = asNodeId(
      'resource.module.db.module.db_subnet_group.aws_db_subnet_group.this[0]',
    );
    const dbId = asNodeId('resource.module.db.module.db_instance.aws_db_instance.this[0]');
    const sgId = asNodeId('resource.module.rds_sg.aws_security_group.this');
    const unrelatedLambdaId = asNodeId('resource.aws_lambda_function.unrelated');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'module.vpc.aws_vpc.this[0]',
            resource: 'aws_vpc',
            name: 'this[0]',
            state: buildTerraformState('module.vpc.aws_vpc.this[0]', {}),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'module.vpc.aws_subnet.private[0]',
            resource: 'aws_subnet',
            name: 'private[0]',
            state: buildTerraformState('module.vpc.aws_subnet.private[0]', {
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'module.vpc.aws_subnet.private[1]',
            resource: 'aws_subnet',
            name: 'private[1]',
            state: buildTerraformState('module.vpc.aws_subnet.private[1]', {
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [dbSubnetGroupId]: {
          id: dbSubnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'module.db.module.db_subnet_group.aws_db_subnet_group.this[0]',
            resource: 'aws_db_subnet_group',
            name: 'this[0]',
            state: buildTerraformState(
              'module.db.module.db_subnet_group.aws_db_subnet_group.this[0]',
              {},
            ),
          },
        },
        [dbId]: {
          id: dbId,
          terraform: {
            kind: 'resource',
            address: 'module.db.module.db_instance.aws_db_instance.this[0]',
            resource: 'aws_db_instance',
            name: 'this[0]',
            state: buildTerraformState('module.db.module.db_instance.aws_db_instance.this[0]', {}),
          },
        },
        [sgId]: {
          id: sgId,
          terraform: {
            kind: 'resource',
            address: 'module.rds_sg.aws_security_group.this',
            resource: 'aws_security_group',
            name: 'this',
          },
        },
        [unrelatedLambdaId]: {
          id: unrelatedLambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.unrelated',
            resource: 'aws_lambda_function',
            name: 'unrelated',
            state: buildTerraformState('aws_lambda_function.unrelated', {
              vpc_config: [
                {
                  vpc_id: 'vpc-unresolved',
                },
              ],
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(subnetAId)?.hints?.topology?.scopeId).toBe(
      'vpc:this[0]:az:eu-west-2a:subnet:private[0]',
    );
    expect(updated.getNodeAttributes(subnetBId)?.hints?.topology?.scopeId).toBe(
      'vpc:this[0]:az:eu-west-2b:subnet:private[1]',
    );
    expect(updated.getNodeAttributes(dbSubnetGroupId)?.hints?.topology?.scopeId).toBe(
      'vpc:this[0]',
    );
    expect(updated.getNodeAttributes(dbId)?.hints?.topology?.scopeId).toBe('vpc:this[0]');
    expect(updated.getNodeAttributes(sgId)?.hints?.topology?.scopeId).toBe('vpc:this[0]');
  });

  it('shoud place lambda and rds from inferred external vpc references when vpc and subnet resources are absent', () => {
    const [rule] = buildRules({ enrichers: ['rds', 'network'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const securityGroupId = asNodeId('resource.aws_security_group.external');
    const lambdaId = asNodeId('resource.aws_lambda_function.worker');
    const dbSubnetGroupId = asNodeId('resource.aws_db_subnet_group.external');
    const dbInstanceId = asNodeId('resource.aws_db_instance.external');
    const dbReplicaId = asNodeId(`${String(dbInstanceId)}:replica:subnet:subnet-ext-b`);

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [securityGroupId]: {
          id: securityGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.external',
            resource: 'aws_security_group',
            name: 'external',
            state: buildTerraformState('aws_security_group.external', {
              id: 'sg-external',
              vpc_id: 'vpc-external',
            }),
          },
        },
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.worker',
            resource: 'aws_lambda_function',
            name: 'worker',
            state: buildTerraformState('aws_lambda_function.worker', {
              vpc_config: [
                {
                  subnet_ids: ['subnet-ext-a', 'subnet-ext-b'],
                  security_group_ids: ['sg-external'],
                },
              ],
            }),
          },
        },
        [dbSubnetGroupId]: {
          id: dbSubnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_subnet_group.external',
            resource: 'aws_db_subnet_group',
            name: 'external',
            state: buildTerraformState('aws_db_subnet_group.external', {
              name: 'external-db-subnets',
              subnet_ids: ['subnet-ext-a', 'subnet-ext-b'],
            }),
          },
        },
        [dbInstanceId]: {
          id: dbInstanceId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_instance.external',
            resource: 'aws_db_instance',
            name: 'external',
            state: buildTerraformState('aws_db_instance.external', {
              db_subnet_group_name: 'external-db-subnets',
              vpc_security_group_ids: ['sg-external'],
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-db-subnet-group'),
          from: dbInstanceId,
          to: dbSubnetGroupId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(securityGroupId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-external',
    );
    expect(updated.getNodeAttributes(lambdaId)?.hints?.topology?.scopeId).toBe('vpc:vpc-external');
    expect(updated.getNodeAttributes(dbInstanceId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-external:az:unknown:subnet:subnet-ext-a',
    );
    expect(updated.getNodeAttributes(dbReplicaId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-external:az:unknown:subnet:subnet-ext-b',
    );
  });

  it('shoud place network-scoped resources by referenced container ids when the network enricher is enabled', () => {
    const [ruleWithoutEnricher] = buildRules();
    const [ruleWithEnricher] = buildRules({ enrichers: ['network'] });
    if (!ruleWithoutEnricher || !ruleWithEnricher) {
      throw new Error('Expected placement rules');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetId = asNodeId('resource.aws_subnet.private_a');
    const subnetBId = asNodeId('resource.aws_subnet.private_b');
    const sgId = asNodeId('resource.aws_security_group.app');
    const sgRuleId = asNodeId('resource.aws_vpc_security_group_ingress_rule.app_from_vpc');
    const routeTableId = asNodeId('resource.aws_route_table.private');
    const natGatewayId = asNodeId('resource.aws_nat_gateway.private');
    const routeId = asNodeId('resource.aws_route.private_default');
    const naclId = asNodeId('resource.aws_network_acl.private');
    const naclRuleId = asNodeId('resource.aws_network_acl_rule.private_allow');
    const loadBalancerId = asNodeId('resource.aws_lb.app');
    const listenerByArnId = asNodeId('resource.aws_lb_listener.by_arn');
    const listenerByEdgeId = asNodeId('resource.aws_lb_listener.by_edge');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', { id: 'vpc-1' }),
          },
        },
        [subnetId]: {
          id: subnetId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.private_a',
            resource: 'aws_subnet',
            name: 'private_a',
            state: buildTerraformState('aws_subnet.private_a', {
              id: 'subnet-1',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.private_b',
            resource: 'aws_subnet',
            name: 'private_b',
            state: buildTerraformState('aws_subnet.private_b', {
              id: 'subnet-2',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [sgId]: {
          id: sgId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.app',
            resource: 'aws_security_group',
            name: 'app',
            state: buildTerraformState('aws_security_group.app', {
              id: 'sg-1',
              vpc_id: 'vpc-1',
            }),
          },
        },
        [sgRuleId]: {
          id: sgRuleId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc_security_group_ingress_rule.app_from_vpc',
            resource: 'aws_vpc_security_group_ingress_rule',
            name: 'app_from_vpc',
            state: buildTerraformState('aws_vpc_security_group_ingress_rule.app_from_vpc', {
              security_group_id: 'sg-1',
            }),
          },
        },
        [routeTableId]: {
          id: routeTableId,
          terraform: {
            kind: 'resource',
            address: 'aws_route_table.private',
            resource: 'aws_route_table',
            name: 'private',
            state: buildTerraformState('aws_route_table.private', {
              id: 'rtb-1',
              vpc_id: 'vpc-1',
            }),
          },
        },
        [natGatewayId]: {
          id: natGatewayId,
          terraform: {
            kind: 'resource',
            address: 'aws_nat_gateway.private',
            resource: 'aws_nat_gateway',
            name: 'private',
            state: buildTerraformState('aws_nat_gateway.private', {
              id: 'nat-1',
              subnet_id: 'subnet-1',
            }),
          },
        },
        [routeId]: {
          id: routeId,
          terraform: {
            kind: 'resource',
            address: 'aws_route.private_default',
            resource: 'aws_route',
            name: 'private_default',
            state: buildTerraformState('aws_route.private_default', {
              route_table_id: 'rtb-1',
              nat_gateway_id: 'nat-1',
            }),
          },
        },
        [naclId]: {
          id: naclId,
          terraform: {
            kind: 'resource',
            address: 'aws_network_acl.private',
            resource: 'aws_network_acl',
            name: 'private',
            state: buildTerraformState('aws_network_acl.private', {
              id: 'acl-1',
              vpc_id: 'vpc-1',
            }),
          },
        },
        [naclRuleId]: {
          id: naclRuleId,
          terraform: {
            kind: 'resource',
            address: 'aws_network_acl_rule.private_allow',
            resource: 'aws_network_acl_rule',
            name: 'private_allow',
            state: buildTerraformState('aws_network_acl_rule.private_allow', {
              network_acl_id: 'acl-1',
            }),
          },
        },
        [loadBalancerId]: {
          id: loadBalancerId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb.app',
            resource: 'aws_lb',
            name: 'app',
            state: buildTerraformState('aws_lb.app', {
              id: 'app-lb',
              arn: 'arn:aws:elasticloadbalancing:eu-west-2:111122223333:loadbalancer/app/app/123',
              subnets: ['subnet-1', 'subnet-2'],
            }),
          },
        },
        [listenerByArnId]: {
          id: listenerByArnId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb_listener.by_arn',
            resource: 'aws_lb_listener',
            name: 'by_arn',
            state: buildTerraformState('aws_lb_listener.by_arn', {
              load_balancer_arn:
                'arn:aws:elasticloadbalancing:eu-west-2:111122223333:loadbalancer/app/app/123',
            }),
          },
        },
        [listenerByEdgeId]: {
          id: listenerByEdgeId,
          terraform: {
            kind: 'resource',
            address: 'aws_lb_listener.by_edge',
            resource: 'aws_lb_listener',
            name: 'by_edge',
            state: buildTerraformState('aws_lb_listener.by_edge', {}),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-subnet-vpc'),
          from: subnetId,
          to: vpcId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-listener-edge-lb'),
          from: listenerByEdgeId,
          to: loadBalancerId,
          attributes: {},
        },
      ],
    };

    const withoutEnricher = applyRuleAcrossNodes(ruleWithoutEnricher, buildAdapter(graph));
    const withEnricher = applyRuleAcrossNodes(ruleWithEnricher, buildAdapter(graph));

    expect(withoutEnricher.getNodeAttributes(sgRuleId)?.hints?.topology).toBeUndefined();
    expect(withoutEnricher.getNodeAttributes(naclRuleId)?.hints?.topology).toBeUndefined();
    expect(withoutEnricher.getNodeAttributes(listenerByArnId)?.hints?.topology).toBeUndefined();
    expect(withoutEnricher.getNodeAttributes(listenerByEdgeId)?.hints?.topology).toBeUndefined();

    expect(withEnricher.getNodeAttributes(sgRuleId)?.hints?.topology?.scopeId).toBe('vpc:vpc-1');
    expect(withEnricher.getNodeAttributes(naclRuleId)?.hints?.topology?.scopeId).toBe('vpc:vpc-1');
    expect(withEnricher.getNodeAttributes(routeId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-1:az:eu-west-2a:subnet:subnet-1',
    );
    expect(withEnricher.getNodeAttributes(listenerByArnId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-1',
    );
    expect(withEnricher.getNodeAttributes(listenerByEdgeId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-1',
    );
  });

  it('shoud place rds by subnet-group relationships only when the rds enricher is enabled', () => {
    const [ruleWithoutEnricher] = buildRules();
    const [ruleWithEnricher] = buildRules({ enrichers: ['rds'] });
    if (!ruleWithoutEnricher || !ruleWithEnricher) {
      throw new Error('Expected placement rules');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetAId = asNodeId('resource.aws_subnet.a');
    const subnetBId = asNodeId('resource.aws_subnet.b');
    const subnetGroupId = asNodeId('resource.aws_db_subnet_group.this');
    const dbId = asNodeId('resource.aws_db_instance.postgres');
    const appId = asNodeId('resource.aws_lambda_function.app');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', {
              id: 'vpc-1',
            }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a',
            resource: 'aws_subnet',
            name: 'a',
            state: buildTerraformState('aws_subnet.a', {
              id: 'subnet-a',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.b',
            resource: 'aws_subnet',
            name: 'b',
            state: buildTerraformState('aws_subnet.b', {
              id: 'subnet-b',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [subnetGroupId]: {
          id: subnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_subnet_group.this',
            resource: 'aws_db_subnet_group',
            name: 'this',
            state: buildTerraformState('aws_db_subnet_group.this', {
              name: 'db-subnets',
              subnet_ids: ['subnet-a', 'subnet-b'],
            }),
          },
        },
        [dbId]: {
          id: dbId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_instance.postgres',
            resource: 'aws_db_instance',
            name: 'postgres',
            state: buildTerraformState('aws_db_instance.postgres', {
              db_subnet_group_name: 'db-subnets',
            }),
          },
        },
        [appId]: {
          id: appId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.app',
            resource: 'aws_lambda_function',
            name: 'app',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-app-db'),
          from: appId,
          to: dbId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-db-subnet-group'),
          from: dbId,
          to: subnetGroupId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-subnet-group-a'),
          from: subnetGroupId,
          to: subnetAId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-subnet-group-b'),
          from: subnetGroupId,
          to: subnetBId,
          attributes: {},
        },
      ],
    };

    const withoutEnricher = applyRuleAcrossNodes(ruleWithoutEnricher, buildAdapter(graph));
    const withEnricher = applyRuleAcrossNodes(ruleWithEnricher, buildAdapter(graph));

    expect(withoutEnricher.getNodeAttributes(dbId)?.hints?.topology).toBeUndefined();
    expect(withEnricher.getNodeAttributes(dbId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-1:az:eu-west-2a:subnet:subnet-a',
        }),
      }),
    );

    const replicaId = asNodeId(`${String(dbId)}:replica:subnet:subnet-b`);
    expect(withEnricher.getNodeAttributes(replicaId)?.id).toBe(replicaId);
    expect(withEnricher.getNodeAttributes(replicaId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-1:az:eu-west-2b:subnet:subnet-b',
        }),
      }),
    );
    expect(
      withEnricher
        .outEdges(replicaId)
        .some((edgeId) => withEnricher.edgeTarget(edgeId) === subnetGroupId),
    ).toBe(true);
    expect(
      withEnricher.inEdges(replicaId).some((edgeId) => withEnricher.edgeSource(edgeId) === appId),
    ).toBe(true);
  });

  it('shoud tolerate missing node lookups and preserve idempotence on reruns', () => {
    const [rule] = buildRules({ enrichers: ['rds'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const firstNodeId = asNodeId('a');
    const missingNodeId = asNodeId('missing');
    const firstNode: TgNodeAttributes = {
      terraform: {
        kind: 'resource',
        address: 'aws_vpc.a',
        resource: 'aws_vpc',
        name: 'a',
        state: buildTerraformState('aws_vpc.a', {
          id: 'vpc-a',
        }),
      },
    };

    let firstNodeLookups = 0;
    const adapter = {
      nodeIds: () => [firstNodeId, missingNodeId],
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === missingNodeId) {
          return undefined;
        }
        if (nodeId === firstNodeId) {
          firstNodeLookups += 1;
          return firstNodeLookups <= 3 ? firstNode : undefined;
        }
        return undefined;
      },
      predecessors: () => [],
      successors: () => [],
      setNodeAttributes: () => adapter,
    } as unknown as AdapterOperations;

    const startNode = adapter.getNodeAttributes(firstNodeId);
    if (!startNode) {
      throw new Error('Expected start node');
    }

    rule.match(firstNodeId, startNode, adapter);
    const updated = rule.apply(firstNodeId, startNode, adapter);

    expect(updated).toBe(adapter);

    const idempotentRule = buildRules({ enrichers: ['rds'] })[0];
    if (!idempotentRule) {
      throw new Error('Expected idempotent rule');
    }

    const graphAdapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [firstNodeId]: {
          id: firstNodeId,
          hints: {
            topology: {
              scopeId: 'vpc:vpc-a',
            },
          },
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.a',
            resource: 'aws_vpc',
            name: 'a',
            state: buildTerraformState('aws_vpc.a', {
              id: 'vpc-a',
            }),
          },
        },
      },
      edges: [],
    });

    const once = applyRuleAcrossNodes(idempotentRule, graphAdapter);
    const twice = applyRuleAcrossNodes(idempotentRule, once);
    expect(twice.toTgGraph()).toStrictEqual(once.toTgGraph());
  });

  it('shoud tolerate missing neighbor node lookups while applying rds enrichment', () => {
    const [rule] = buildRules({ enrichers: ['rds'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const dbNodeId = asNodeId('resource.aws_db_instance.missing_neighbor');
    const missingNeighborId = asNodeId('resource.missing');

    const dbNode: TgNodeAttributes = {
      terraform: {
        kind: 'resource',
        address: 'aws_db_instance.missing_neighbor',
        resource: 'aws_db_instance',
        name: 'missing_neighbor',
        state: buildTerraformState('aws_db_instance.missing_neighbor', {
          db_subnet_group_name: 'does-not-exist',
        }),
      },
    };

    const adapter = {
      nodeIds: () => [dbNodeId],
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === dbNodeId) {
          return dbNode;
        }
        return undefined;
      },
      predecessors: (nodeId: string) => (nodeId === dbNodeId ? [missingNeighborId] : []),
      successors: () => [],
      setNodeAttributes: () => adapter,
    } as unknown as AdapterOperations;

    const startNode = adapter.getNodeAttributes(dbNodeId);
    if (!startNode) {
      throw new Error('Expected start node');
    }

    rule.match(dbNodeId, startNode, adapter);
    const updated = rule.apply(dbNodeId, startNode, adapter);
    expect(updated).toBe(adapter);
  });

  it('shoud infer subnet keys from rds subnet-group state even when subnet nodes are absent', () => {
    const [rule] = buildRules({ enrichers: ['rds'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const dbId = asNodeId('resource.aws_db_instance.only_group');
    const dbSubnetGroupId = asNodeId('resource.aws_db_subnet_group.only_group');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [dbId]: {
          id: dbId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_instance.only_group',
            resource: 'aws_db_instance',
            name: 'only_group',
            state: buildTerraformState('aws_db_instance.only_group', {
              db_subnet_group_name: 'group-only',
            }),
          },
        },
        [dbSubnetGroupId]: {
          id: dbSubnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_subnet_group.only_group',
            resource: 'aws_db_subnet_group',
            name: 'only_group',
            state: buildTerraformState('aws_db_subnet_group.only_group', {
              name: 'group-only',
              subnet_ids: ['subnet-unknown-from-group'],
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-db-group-only'),
          from: dbId,
          to: dbSubnetGroupId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(dbId)?.hints?.topology).toBeUndefined();
  });

  it('shoud handle sparse and duplicate resources while keeping unresolved placements unscoped', () => {
    const [rule] = buildRules({ enrichers: ['rds'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcPrimaryId = asNodeId('resource.aws_vpc.primary');
    const vpcDuplicateId = asNodeId('resource.aws_vpc.duplicate');
    const vpcSparseId = asNodeId('resource.aws_vpc.sparse');
    const subnetDuplicateAId = asNodeId('resource.aws_subnet.duplicate_a');
    const subnetDuplicateBId = asNodeId('resource.aws_subnet.duplicate_b');
    const subnetMissingVpcNodeId = asNodeId('resource.aws_subnet.missing_vpc');
    const subnetNeighborFallbackId = asNodeId('resource.aws_subnet.neighbor_fallback');
    const subnetSparseId = asNodeId('resource.aws_subnet.sparse');
    const nodeViaVpcNeighborId = asNodeId('resource.aws_nat_gateway.vpc_neighbor');
    const unresolvedSubnetRefNodeId = asNodeId('resource.aws_instance.unresolved_subnet_ref');
    const dbId = asNodeId('resource.aws_db_instance.sparse');
    const dbSubnetGroupId = asNodeId('resource.aws_db_subnet_group.sparse');
    const unrelatedNeighborId = asNodeId('resource.aws_iam_role.unrelated');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcPrimaryId]: {
          id: vpcPrimaryId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.primary',
            resource: 'aws_vpc',
            name: 'primary',
            state: buildTerraformState('aws_vpc.primary', { id: 'vpc-dupe' }),
          },
        },
        [vpcDuplicateId]: {
          id: vpcDuplicateId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.duplicate',
            resource: 'aws_vpc',
            name: 'duplicate',
            state: buildTerraformState('aws_vpc.duplicate', { id: 'vpc-dupe' }),
          },
        },
        [vpcSparseId]: {
          id: vpcSparseId,
          terraform: {
            kind: 'resource',
            resource: 'aws_vpc',
          },
        },
        [subnetDuplicateAId]: {
          id: subnetDuplicateAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.duplicate_a',
            resource: 'aws_subnet',
            name: 'duplicate_a',
            state: buildTerraformState('aws_subnet.duplicate_a', {
              id: 'subnet-duplicate',
              vpc_id: 'vpc-dupe',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetDuplicateBId]: {
          id: subnetDuplicateBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.duplicate_b',
            resource: 'aws_subnet',
            name: 'duplicate_b',
            state: buildTerraformState('aws_subnet.duplicate_b', {
              id: 'subnet-duplicate',
              vpc_id: 'vpc-dupe',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetMissingVpcNodeId]: {
          id: subnetMissingVpcNodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.missing_vpc',
            resource: 'aws_subnet',
            name: 'missing_vpc',
            state: buildTerraformState('aws_subnet.missing_vpc', {
              id: 'subnet-missing-vpc',
              vpc_id: 'vpc-inferred',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [subnetNeighborFallbackId]: {
          id: subnetNeighborFallbackId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.neighbor_fallback',
            resource: 'aws_subnet',
            name: 'neighbor_fallback',
            state: buildTerraformState('aws_subnet.neighbor_fallback', {
              id: 'subnet-neighbor-fallback',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetSparseId]: {
          id: subnetSparseId,
          terraform: {
            kind: 'resource',
            resource: 'aws_subnet',
          },
        },
        [nodeViaVpcNeighborId]: {
          id: nodeViaVpcNeighborId,
          terraform: {
            kind: 'resource',
            address: 'aws_nat_gateway.vpc_neighbor',
            resource: 'aws_nat_gateway',
            name: 'vpc_neighbor',
            state: {
              source: 'state_show',
              effective: null,
              instances: [],
            },
          },
        },
        [unresolvedSubnetRefNodeId]: {
          id: unresolvedSubnetRefNodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.unresolved_subnet_ref',
            resource: 'aws_instance',
            name: 'unresolved_subnet_ref',
            state: buildTerraformState('aws_instance.unresolved_subnet_ref', {
              subnet_id: 'subnet-unresolved',
            }),
          },
        },
        [dbSubnetGroupId]: {
          id: dbSubnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_subnet_group.sparse',
            resource: 'aws_db_subnet_group',
            name: 'sparse',
            state: buildTerraformState('aws_db_subnet_group.sparse', {
              name: 'sparse-group',
              subnet_ids: ['subnet-inferred-new'],
            }),
          },
        },
        [unrelatedNeighborId]: {
          id: unrelatedNeighborId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.unrelated',
            resource: 'aws_iam_role',
            name: 'unrelated',
          },
        },
        [dbId]: {
          id: dbId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_instance.sparse',
            resource: 'aws_db_instance',
            name: 'sparse',
            state: buildTerraformState('aws_db_instance.sparse', {
              db_subnet_group_name: 'missing-group-name',
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-subnet-vpc-neighbor'),
          from: subnetNeighborFallbackId,
          to: vpcPrimaryId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-node-vpc-neighbor'),
          from: nodeViaVpcNeighborId,
          to: vpcPrimaryId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-db-group'),
          from: dbId,
          to: dbSubnetGroupId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-db-unrelated'),
          from: dbId,
          to: unrelatedNeighborId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(nodeViaVpcNeighborId)?.hints).toEqual(
      expect.objectContaining({
        topology: expect.objectContaining({
          scopeId: 'vpc:vpc-dupe',
        }),
      }),
    );
    expect(updated.getNodeAttributes(unresolvedSubnetRefNodeId)?.hints?.topology).toBeUndefined();
    expect(updated.getNodeAttributes(dbId)?.hints?.topology).toBeUndefined();
  });

  it('shoud enrich and clone elasticache replication-group and cluster across subnets', () => {
    const [rule] = buildRules({ enrichers: ['elasticache'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.cache');
    const subnetAId = asNodeId('resource.aws_subnet.cache_a');
    const subnetBId = asNodeId('resource.aws_subnet.cache_b');
    const subnetGroupId = asNodeId('resource.aws_elasticache_subnet_group.this');
    const rgId = asNodeId('resource.aws_elasticache_replication_group.this');
    const clusterId = asNodeId('resource.aws_elasticache_cluster.this');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.cache',
            resource: 'aws_vpc',
            name: 'cache',
            state: buildTerraformState('aws_vpc.cache', { id: 'vpc-cache' }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.cache_a',
            resource: 'aws_subnet',
            name: 'cache_a',
            state: buildTerraformState('aws_subnet.cache_a', {
              id: 'subnet-cache-a',
              vpc_id: 'vpc-cache',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.cache_b',
            resource: 'aws_subnet',
            name: 'cache_b',
            state: buildTerraformState('aws_subnet.cache_b', {
              id: 'subnet-cache-b',
              vpc_id: 'vpc-cache',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [subnetGroupId]: {
          id: subnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_elasticache_subnet_group.this',
            resource: 'aws_elasticache_subnet_group',
            name: 'this',
            state: buildTerraformState('aws_elasticache_subnet_group.this', {
              name: 'cache-subnets',
              subnet_ids: ['subnet-cache-a', 'subnet-cache-b'],
            }),
          },
        },
        [rgId]: {
          id: rgId,
          terraform: {
            kind: 'resource',
            address: 'aws_elasticache_replication_group.this',
            resource: 'aws_elasticache_replication_group',
            name: 'this',
            state: buildTerraformState('aws_elasticache_replication_group.this', {
              subnet_group_name: 'cache-subnets',
            }),
          },
        },
        [clusterId]: {
          id: clusterId,
          terraform: {
            kind: 'resource',
            address: 'aws_elasticache_cluster.this',
            resource: 'aws_elasticache_cluster',
            name: 'this',
            state: buildTerraformState('aws_elasticache_cluster.this', {}),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-group-a'),
          from: subnetGroupId,
          to: subnetAId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-group-b'),
          from: subnetGroupId,
          to: subnetBId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-rg-group'),
          from: rgId,
          to: subnetGroupId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-cluster-group'),
          from: clusterId,
          to: subnetGroupId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(rgId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-cache:az:eu-west-2a:subnet:subnet-cache-a',
    );
    expect(
      updated.getNodeAttributes(asNodeId(`${String(rgId)}:replica:subnet:subnet-cache-b`))?.hints
        ?.topology?.scopeId,
    ).toBe('vpc:vpc-cache:az:eu-west-2b:subnet:subnet-cache-b');

    expect(updated.getNodeAttributes(clusterId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-cache:az:eu-west-2a:subnet:subnet-cache-a',
    );
    expect(
      updated.getNodeAttributes(asNodeId(`${String(clusterId)}:replica:subnet:subnet-cache-b`))
        ?.hints?.topology?.scopeId,
    ).toBe('vpc:vpc-cache:az:eu-west-2b:subnet:subnet-cache-b');
  });

  it('shoud enrich and clone ecs services from network configuration with edge fallback', () => {
    const [rule] = buildRules({ enrichers: ['ecs'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.ecs');
    const subnetAId = asNodeId('resource.aws_subnet.ecs_a');
    const subnetBId = asNodeId('resource.aws_subnet.ecs_b');
    const serviceObjectId = asNodeId('resource.aws_ecs_service.object');
    const serviceArrayId = asNodeId('resource.aws_ecs_service.array');
    const serviceFallbackId = asNodeId('resource.aws_ecs_service.fallback');
    const malformedReplicaId = asNodeId('resource.aws_iam_role.bad:replica:subnet:');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.ecs',
            resource: 'aws_vpc',
            name: 'ecs',
            state: buildTerraformState('aws_vpc.ecs', { id: 'vpc-ecs' }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.ecs_a',
            resource: 'aws_subnet',
            name: 'ecs_a',
            state: buildTerraformState('aws_subnet.ecs_a', {
              id: 'subnet-ecs-a',
              vpc_id: 'vpc-ecs',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.ecs_b',
            resource: 'aws_subnet',
            name: 'ecs_b',
            state: buildTerraformState('aws_subnet.ecs_b', {
              id: 'subnet-ecs-b',
              vpc_id: 'vpc-ecs',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [serviceObjectId]: {
          id: serviceObjectId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_service.object',
            resource: 'aws_ecs_service',
            name: 'object',
            state: buildTerraformState('aws_ecs_service.object', {
              network_configuration: {
                subnets: ['subnet-ecs-a', 'subnet-ecs-b'],
              },
            }),
          },
        },
        [serviceArrayId]: {
          id: serviceArrayId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_service.array',
            resource: 'aws_ecs_service',
            name: 'array',
            state: buildTerraformState('aws_ecs_service.array', {
              network_configuration: [
                {
                  subnet_ids: ['subnet-ecs-a', 'subnet-ecs-b'],
                },
                'invalid',
              ],
            }),
          },
        },
        [serviceFallbackId]: {
          id: serviceFallbackId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_service.fallback',
            resource: 'aws_ecs_service',
            name: 'fallback',
            state: buildTerraformState('aws_ecs_service.fallback', {}),
          },
        },
        [malformedReplicaId]: {
          id: malformedReplicaId,
          terraform: {
            kind: 'resource',
            address: 'aws_iam_role.bad',
            resource: 'aws_iam_role',
            name: 'bad',
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-ecs-fallback-subnet'),
          from: serviceFallbackId,
          to: subnetAId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(serviceObjectId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-ecs:az:eu-west-2a:subnet:subnet-ecs-a',
    );
    expect(
      updated.getNodeAttributes(asNodeId(`${String(serviceObjectId)}:replica:subnet:subnet-ecs-b`))
        ?.hints?.topology?.scopeId,
    ).toBe('vpc:vpc-ecs:az:eu-west-2b:subnet:subnet-ecs-b');

    expect(updated.getNodeAttributes(serviceArrayId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-ecs:az:eu-west-2a:subnet:subnet-ecs-a',
    );
    expect(
      updated.getNodeAttributes(asNodeId(`${String(serviceArrayId)}:replica:subnet:subnet-ecs-b`))
        ?.hints?.topology?.scopeId,
    ).toBe('vpc:vpc-ecs:az:eu-west-2b:subnet:subnet-ecs-b');

    expect(updated.getNodeAttributes(serviceFallbackId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-ecs:az:eu-west-2a:subnet:subnet-ecs-a',
    );
    expect(updated.getNodeAttributes(malformedReplicaId)?.hints?.topology).toBeUndefined();
  });

  it('shoud scope ecs services/task sets but keep ecs cluster and task definition unscoped', () => {
    const [rule] = buildRules({ enrichers: ['ecs'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.ecs');
    const subnetAId = asNodeId('resource.aws_subnet.ecs_a');
    const subnetBId = asNodeId('resource.aws_subnet.ecs_b');
    const clusterId = asNodeId('resource.aws_ecs_cluster.main');
    const taskDefinitionId = asNodeId('resource.aws_ecs_task_definition.main');
    const serviceId = asNodeId('resource.aws_ecs_service.main');
    const taskSetId = asNodeId('resource.aws_ecs_task_set.main');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.ecs',
            resource: 'aws_vpc',
            name: 'ecs',
            state: buildTerraformState('aws_vpc.ecs', { id: 'vpc-ecs' }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.ecs_a',
            resource: 'aws_subnet',
            name: 'ecs_a',
            state: buildTerraformState('aws_subnet.ecs_a', {
              id: 'subnet-ecs-a',
              vpc_id: 'vpc-ecs',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.ecs_b',
            resource: 'aws_subnet',
            name: 'ecs_b',
            state: buildTerraformState('aws_subnet.ecs_b', {
              id: 'subnet-ecs-b',
              vpc_id: 'vpc-ecs',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [clusterId]: {
          id: clusterId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_cluster.main',
            resource: 'aws_ecs_cluster',
            name: 'main',
            state: buildTerraformState('aws_ecs_cluster.main', {
              name: 'main',
            }),
          },
        },
        [taskDefinitionId]: {
          id: taskDefinitionId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_task_definition.main',
            resource: 'aws_ecs_task_definition',
            name: 'main',
            state: buildTerraformState('aws_ecs_task_definition.main', {
              family: 'main',
            }),
          },
        },
        [serviceId]: {
          id: serviceId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_service.main',
            resource: 'aws_ecs_service',
            name: 'main',
            state: buildTerraformState('aws_ecs_service.main', {
              cluster: 'main',
              task_definition: 'main:1',
              network_configuration: {
                subnet_ids: ['subnet-ecs-a', 'subnet-ecs-b'],
              },
            }),
          },
        },
        [taskSetId]: {
          id: taskSetId,
          terraform: {
            kind: 'resource',
            address: 'aws_ecs_task_set.main',
            resource: 'aws_ecs_task_set',
            name: 'main',
            state: buildTerraformState('aws_ecs_task_set.main', {
              cluster: 'main',
              task_definition: 'main:1',
              network_configuration: {
                subnets: ['subnet-ecs-a', 'subnet-ecs-b'],
              },
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-ecs-service-cluster'),
          from: serviceId,
          to: clusterId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-ecs-service-task-definition'),
          from: serviceId,
          to: taskDefinitionId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-ecs-task-set-service'),
          from: taskSetId,
          to: serviceId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);

    expect(updated.getNodeAttributes(serviceId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-ecs:az:eu-west-2a:subnet:subnet-ecs-a',
    );
    expect(
      updated.getNodeAttributes(asNodeId(`${String(serviceId)}:replica:subnet:subnet-ecs-b`))?.hints
        ?.topology?.scopeId,
    ).toBe('vpc:vpc-ecs:az:eu-west-2b:subnet:subnet-ecs-b');

    expect(updated.getNodeAttributes(taskSetId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-ecs:az:eu-west-2a:subnet:subnet-ecs-a',
    );
    expect(
      updated.getNodeAttributes(asNodeId(`${String(taskSetId)}:replica:subnet:subnet-ecs-b`))?.hints
        ?.topology?.scopeId,
    ).toBe('vpc:vpc-ecs:az:eu-west-2b:subnet:subnet-ecs-b');

    expect(updated.getNodeAttributes(clusterId)?.hints?.topology).toBeUndefined();
    expect(updated.getNodeAttributes(taskDefinitionId)?.hints?.topology).toBeUndefined();
  });

  it('shoud keep clone creation idempotent for enricher-managed resources', () => {
    const [rule] = buildRules({ enrichers: ['rds'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetAId = asNodeId('resource.aws_subnet.a');
    const subnetBId = asNodeId('resource.aws_subnet.b');
    const subnetGroupId = asNodeId('resource.aws_db_subnet_group.this');
    const dbId = asNodeId('resource.aws_db_instance.postgres');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', {
              id: 'vpc-1',
            }),
          },
        },
        [subnetAId]: {
          id: subnetAId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a',
            resource: 'aws_subnet',
            name: 'a',
            state: buildTerraformState('aws_subnet.a', {
              id: 'subnet-a',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2a',
            }),
          },
        },
        [subnetBId]: {
          id: subnetBId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.b',
            resource: 'aws_subnet',
            name: 'b',
            state: buildTerraformState('aws_subnet.b', {
              id: 'subnet-b',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
        [subnetGroupId]: {
          id: subnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_subnet_group.this',
            resource: 'aws_db_subnet_group',
            name: 'this',
            state: buildTerraformState('aws_db_subnet_group.this', {
              name: 'db-subnets',
              subnet_ids: ['subnet-a', 'subnet-b'],
            }),
          },
        },
        [dbId]: {
          id: dbId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_instance.postgres',
            resource: 'aws_db_instance',
            name: 'postgres',
            state: buildTerraformState('aws_db_instance.postgres', {
              db_subnet_group_name: 'db-subnets',
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-db-subnet-group'),
          from: dbId,
          to: subnetGroupId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-subnet-group-a'),
          from: subnetGroupId,
          to: subnetAId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-subnet-group-b'),
          from: subnetGroupId,
          to: subnetBId,
          attributes: {},
        },
      ],
    };

    const once = applyRuleAcrossNodes(rule, buildAdapter(graph));
    const twice = applyRuleAcrossNodes(rule, once);

    const replicaId = asNodeId(`${String(dbId)}:replica:subnet:subnet-b`);
    expect(twice.getNodeAttributes(replicaId)).toBeDefined();
    expect(twice.nodeIds().filter((nodeId) => String(nodeId) === String(replicaId))).toHaveLength(
      1,
    );
    expect(twice.toTgGraph()).toStrictEqual(once.toTgGraph());
  });

  it('shoud tolerate subnet-group resources with sparse identifiers', () => {
    const [rule] = buildRules({ enrichers: ['rds', 'elasticache'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const dbGroupId = asNodeId('resource.aws_db_subnet_group.sparse_identifiers');
    const cacheGroupId = asNodeId('resource.aws_elasticache_subnet_group.sparse_identifiers');
    const noResourceId = asNodeId('resource.no_resource');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [dbGroupId]: {
          id: dbGroupId,
          terraform: {
            kind: 'resource',
            resource: 'aws_db_subnet_group',
          },
        },
        [cacheGroupId]: {
          id: cacheGroupId,
          terraform: {
            kind: 'resource',
            resource: 'aws_elasticache_subnet_group',
          },
        },
        [noResourceId]: {
          id: noResourceId,
          terraform: {
            kind: 'resource',
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    expect(updated.getNodeAttributes(dbGroupId)).toBeDefined();
    expect(updated.getNodeAttributes(cacheGroupId)).toBeDefined();
    expect(updated.getNodeAttributes(noResourceId)).toBeDefined();
  });

  it('shoud suppress architecture-noise resources and reconnect their edges in architecture mode', () => {
    const [rule] = buildRules({ mode: 'architecture' });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const appId = asNodeId('resource.aws_instance.app');
    const ingressRuleId = asNodeId('resource.aws_vpc_security_group_ingress_rule.sg_rule');
    const securityGroupId = asNodeId('resource.aws_security_group.app');
    const vpcId = asNodeId('resource.aws_vpc.main');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [appId]: {
          id: appId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.app',
            resource: 'aws_instance',
            name: 'app',
          },
        },
        [ingressRuleId]: {
          id: ingressRuleId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc_security_group_ingress_rule.sg_rule',
            resource: 'aws_vpc_security_group_ingress_rule',
            name: 'sg_rule',
          },
        },
        [securityGroupId]: {
          id: securityGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.app',
            resource: 'aws_security_group',
            name: 'app',
            state: buildTerraformState('aws_security_group.app', {
              vpc_id: 'vpc-main',
            }),
          },
        },
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', {
              id: 'vpc-main',
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-app-ingress-rule'),
          from: appId,
          to: ingressRuleId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-ingress-rule-sg'),
          from: ingressRuleId,
          to: securityGroupId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-ingress-rule-vpc'),
          from: ingressRuleId,
          to: vpcId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-sg-vpc'),
          from: securityGroupId,
          to: vpcId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    expect(updated.getNodeAttributes(ingressRuleId)).toBeUndefined();
    expect(
      updated.outEdges(appId).some((edgeId) => updated.edgeTarget(edgeId) === securityGroupId),
    ).toBe(true);
    expect(updated.outEdges(appId).some((edgeId) => updated.edgeTarget(edgeId) === vpcId)).toBe(
      true,
    );
  });

  it('shoud keep architecture-level resources but suppress additional route resources in minimal mode', () => {
    const [architectureRule] = buildRules({ mode: 'architecture' });
    const [minimalRule] = buildRules({ mode: 'minimal' });
    if (!architectureRule || !minimalRule) {
      throw new Error('Expected placement rules');
    }

    const appId = asNodeId('resource.aws_instance.app');
    const routeId = asNodeId('resource.aws_route.private_default');
    const routeTableId = asNodeId('resource.aws_route_table.private');
    const vpcId = asNodeId('resource.aws_vpc.main');

    const graph: TgGraph = {
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [appId]: {
          id: appId,
          terraform: {
            kind: 'resource',
            address: 'aws_instance.app',
            resource: 'aws_instance',
            name: 'app',
          },
        },
        [routeId]: {
          id: routeId,
          terraform: {
            kind: 'resource',
            address: 'aws_route.private_default',
            resource: 'aws_route',
            name: 'private_default',
          },
        },
        [routeTableId]: {
          id: routeTableId,
          terraform: {
            kind: 'resource',
            address: 'aws_route_table.private',
            resource: 'aws_route_table',
            name: 'private',
          },
        },
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', {
              id: 'vpc-main',
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-app-route'),
          from: appId,
          to: routeId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-route-route-table'),
          from: routeId,
          to: routeTableId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-route-table-vpc'),
          from: routeTableId,
          to: vpcId,
          attributes: {},
        },
      ],
    };

    const architectureView = applyRuleAcrossNodes(architectureRule, buildAdapter(graph));
    const minimalView = applyRuleAcrossNodes(minimalRule, buildAdapter(graph));

    expect(architectureView.getNodeAttributes(routeId)).toBeDefined();
    expect(architectureView.getNodeAttributes(routeTableId)).toBeDefined();

    expect(minimalView.getNodeAttributes(routeId)).toBeUndefined();
    expect(minimalView.getNodeAttributes(routeTableId)).toBeUndefined();
    expect(
      minimalView.outEdges(appId).some((edgeId) => minimalView.edgeTarget(edgeId) === vpcId),
    ).toBe(true);
  });

  it('shoud infer and place direct vpc references without explicit vpc resource nodes', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const sgId = asNodeId('resource.aws_security_group.inferred');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sgId]: {
          id: sgId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.inferred',
            resource: 'aws_security_group',
            name: 'inferred',
            state: buildTerraformState('aws_security_group.inferred', {
              vpc_id: 'vpc-inferred-direct',
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    expect(updated.getNodeAttributes(sgId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-inferred-direct',
    );
  });

  it('shoud infer late vpc identifiers that appear only during placement resolution', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    let readCount = 0;
    const values = {
      get vpc_id() {
        readCount += 1;
        return readCount === 1 ? undefined : 'vpc-late';
      },
    } as Record<string, unknown>;

    const sgId = asNodeId('resource.aws_security_group.late');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [sgId]: {
          id: sgId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.late',
            resource: 'aws_security_group',
            name: 'late',
            state: buildTerraformState('aws_security_group.late', values),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    expect(updated.getNodeAttributes(sgId)?.hints?.topology?.scopeId).toBe('vpc:vpc-late');
  });

  it('shoud fallback multi-subnet enricher-managed resources to a single placeable vpc', () => {
    const [rule] = buildRules({ enrichers: ['rds'] });
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const externalSgId = asNodeId('resource.aws_security_group.external');
    const subnetGroupId = asNodeId('resource.aws_db_subnet_group.fallback');
    const dbId = asNodeId('resource.aws_db_instance.fallback');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.main',
            resource: 'aws_vpc',
            name: 'main',
            state: buildTerraformState('aws_vpc.main', {
              id: 'vpc-1',
            }),
          },
        },
        [externalSgId]: {
          id: externalSgId,
          terraform: {
            kind: 'resource',
            address: 'aws_security_group.external',
            resource: 'aws_security_group',
            name: 'external',
            state: buildTerraformState('aws_security_group.external', {
              vpc_id: 'vpc-external',
            }),
          },
        },
        [subnetGroupId]: {
          id: subnetGroupId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_subnet_group.fallback',
            resource: 'aws_db_subnet_group',
            name: 'fallback',
            state: buildTerraformState('aws_db_subnet_group.fallback', {
              name: 'fallback-subnets',
              subnet_ids: ['subnet-fallback-a', 'subnet-fallback-b'],
            }),
          },
        },
        [dbId]: {
          id: dbId,
          terraform: {
            kind: 'resource',
            address: 'aws_db_instance.fallback',
            resource: 'aws_db_instance',
            name: 'fallback',
            state: buildTerraformState('aws_db_instance.fallback', {
              db_subnet_group_name: 'fallback-subnets',
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-db-to-subnet-group-fallback'),
          from: dbId,
          to: subnetGroupId,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    expect(updated.getNodeAttributes(dbId)?.hints?.topology?.scopeId).toBe('vpc:vpc-1');
    expect(updated.getNodeAttributes(externalSgId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-external',
    );
    expect(
      updated.getNodeAttributes(asNodeId(`${String(dbId)}:replica:subnet:subnet-fallback-b`)),
    ).toBeUndefined();
  });

  it('shoud infer vpc identifiers for subnets when vpc_id becomes available after initial lookup', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    let readCount = 0;
    const values = {
      id: 'subnet-dynamic',
      get vpc_id() {
        readCount += 1;
        return readCount === 1 ? undefined : 'vpc-dynamic';
      },
    } as Record<string, unknown>;

    const subnetId = asNodeId('resource.aws_subnet.dynamic');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [subnetId]: {
          id: subnetId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.dynamic',
            resource: 'aws_subnet',
            name: 'dynamic',
            state: buildTerraformState('aws_subnet.dynamic', values),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    expect(updated.getNodeAttributes(subnetId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-dynamic:az:unknown:subnet:subnet-dynamic',
    );
  });

  it('shoud tolerate disappearing subnet nodes during topology fallback resolution', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const subnetId = asNodeId('resource.aws_subnet.ephemeral');
    const subnetNode: TgNodeAttributes = {
      terraform: {
        kind: 'resource',
        address: 'aws_subnet.ephemeral',
        resource: 'aws_subnet',
        name: 'ephemeral',
        state: buildTerraformState('aws_subnet.ephemeral', {
          id: 'subnet-ephemeral',
        }),
      },
    };

    let subnetLookups = 0;
    const adapter = {
      nodeIds: () => [subnetId],
      getNodeAttributes: (nodeId: string) => {
        if (nodeId !== subnetId) {
          return undefined;
        }

        subnetLookups += 1;
        return subnetLookups <= 2 ? subnetNode : undefined;
      },
      predecessors: () => [],
      successors: () => [],
      setNodeAttributes: () => adapter,
      inEdges: () => [],
      outEdges: () => [],
      edgeSource: () => asNodeId(''),
      edgeTarget: () => asNodeId(''),
      getEdgeAttributes: () => ({}),
    } as unknown as AdapterOperations;

    const startNode = adapter.getNodeAttributes(subnetId);
    if (!startNode) {
      throw new Error('Expected start node');
    }

    rule.match(subnetId, startNode, adapter);
    const updated = rule.apply(subnetId, startNode, adapter);
    expect(updated).toBe(adapter);
  });

  it('shoud fallback subnet scopes to the single known vpc when module and edge inference is unavailable', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected placement rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.singleton');
    const subnetId = asNodeId('resource.aws_subnet.singleton');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcId]: {
          id: vpcId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.singleton',
            resource: 'aws_vpc',
            name: 'singleton',
            state: buildTerraformState('aws_vpc.singleton', {
              id: 'vpc-singleton',
            }),
          },
        },
        [subnetId]: {
          id: subnetId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.singleton',
            resource: 'aws_subnet',
            name: 'singleton',
            state: buildTerraformState('aws_subnet.singleton', {
              id: 'subnet-singleton',
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    expect(updated.getNodeAttributes(subnetId)?.hints?.topology?.scopeId).toBe(
      'vpc:vpc-singleton:az:unknown:subnet:subnet-singleton',
    );
  });
});
