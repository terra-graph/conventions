import {
  type AdapterOperations,
  type BaseRule,
  type GraphPluginBuildInput,
  GraphologyAdapter,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  TG_SCHEMA_VERSION,
  type TgGraph,
  asEdgeId,
  asNodeId,
} from '@terra-graph/core';
import { VpcTopologyPlugin } from './Network/VpcTopologyPlugin.js';

const buildRules = (): BaseRule[] => {
  const plugin = new VpcTopologyPlugin();
  const result = plugin.build({
    options: {},
    namedRules: new NamedRuleRegistry(),
    namedRuleSets: new NamedRuleSetRegistry(),
  } as GraphPluginBuildInput<Record<string, never>>);

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

describe('VpcTopologyPlugin.build', () => {
  it('shoud build one normalize phase rule', () => {
    const plugin = new VpcTopologyPlugin();
    const result = plugin.build({
      options: {},
      namedRules: new NamedRuleRegistry(),
      namedRuleSets: new NamedRuleSetRegistry(),
    } as GraphPluginBuildInput<Record<string, never>>);
    const rules = buildRules();

    expect(result.phases).toHaveLength(1);
    expect(result.phases?.[0]?.phase).toBe('normalize');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.serialize().id).toBe('ApplyVpcTopologyHints');
  });

  it('shoud no-op when apply is invoked before matching', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
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

describe('VpcTopologyPlugin.ApplyVpcTopologyHints', () => {
  it('shoud build vpc/az/subnet scopes from vpc and subnet resources only', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetAId = asNodeId('resource.aws_subnet.a');
    const subnetA2Id = asNodeId('resource.aws_subnet.a2');
    const subnetBId = asNodeId('resource.aws_subnet.b');
    const instanceId = asNodeId('resource.aws_instance.web');

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
        [subnetA2Id]: {
          id: subnetA2Id,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a2',
            resource: 'aws_subnet',
            name: 'a2',
            state: buildTerraformState('aws_subnet.a2', {
              id: 'subnet-3',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2a',
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
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const tg = updated.toTgGraph() as TgGraph & {
      hints?: {
        topology?: {
          scopes?: Record<string, { order: number }>;
        };
      };
    };

    const scopes = tg.hints?.topology?.scopes ?? {};
    expect(scopes['vpc:vpc-1']).toBeDefined();
    expect(scopes['vpc:vpc-1:az:eu-west-2a']).toBeDefined();
    expect(scopes['vpc:vpc-1:az:eu-west-2a:subnet:subnet-1']).toBeDefined();
    expect(scopes['vpc:vpc-1:az:eu-west-2a:subnet:subnet-3']).toBeDefined();
    expect(scopes['vpc:vpc-1:az:eu-west-2b']).toBeDefined();
    expect(scopes['vpc:vpc-1:az:eu-west-2b:subnet:subnet-2']).toBeDefined();
    expect(scopes['vpc:vpc-1:az:eu-west-2a']).toMatchObject({
      layout: {
        direction: 'vertical',
        mode: 'symmetric',
        groupId: 'vpc:vpc-1:az-lanes',
        laneKey: 'eu-west-2a',
      },
    });
    expect(scopes['vpc:vpc-1:az:eu-west-2b']).toMatchObject({
      layout: {
        direction: 'vertical',
        mode: 'symmetric',
        groupId: 'vpc:vpc-1:az-lanes',
        laneKey: 'eu-west-2b',
      },
    });
    expect(scopes['vpc:vpc-1']).toMatchObject({
      layout: {
        direction: 'horizontal',
      },
    });
    expect(scopes['vpc:vpc-1:az:eu-west-2a:subnet:subnet-1']).toMatchObject({
      layout: {
        slotKey: 'a',
      },
    });
    expect(scopes['vpc:vpc-1:az:eu-west-2a:subnet:subnet-3']).toMatchObject({
      layout: {
        slotKey: 'a2',
      },
    });
    expect(scopes['vpc:vpc-1:az:eu-west-2b:subnet:subnet-2']).toMatchObject({
      layout: {
        slotKey: 'b',
      },
    });

    expect(updated.getNodeAttributes(instanceId)?.hints?.topology).toBeUndefined();

    const orderedScopeIds = Object.entries(scopes)
      .sort((left, right) => left[1].order - right[1].order)
      .map(([id]) => id);

    expect(orderedScopeIds).toStrictEqual([
      'vpc:vpc-1',
      'vpc:vpc-1:az:eu-west-2a',
      'vpc:vpc-1:az:eu-west-2a:subnet:subnet-1',
      'vpc:vpc-1:az:eu-west-2a:subnet:subnet-3',
      'vpc:vpc-1:az:eu-west-2b',
      'vpc:vpc-1:az:eu-west-2b:subnet:subnet-2',
    ]);
  });

  it('shoud infer missing vpc scopes from subnet references and fallback to neighboring vpc nodes', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcNodeId = asNodeId('resource.aws_vpc.known');
    const subnetFromReference = asNodeId('resource.aws_subnet.ref');
    const subnetFromNeighbor = asNodeId('resource.aws_subnet.neighbor');
    const subnetUnknown = asNodeId('resource.aws_subnet.unknown');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcNodeId]: {
          id: vpcNodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.known',
            resource: 'aws_vpc',
            name: 'known',
            state: buildTerraformState('aws_vpc.known', {
              id: 'vpc-known',
            }),
          },
        },
        [subnetFromReference]: {
          id: subnetFromReference,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.ref',
            resource: 'aws_subnet',
            name: 'ref',
            state: buildTerraformState('aws_subnet.ref', {
              id: 'subnet-ref',
              vpc_id: 'vpc-inferred',
            }),
          },
        },
        [subnetFromNeighbor]: {
          id: subnetFromNeighbor,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.neighbor',
            resource: 'aws_subnet',
            name: 'neighbor',
            state: buildTerraformState('aws_subnet.neighbor', {
              id: 'subnet-neighbor',
            }),
          },
        },
        [subnetUnknown]: {
          id: subnetUnknown,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.unknown',
            resource: 'aws_subnet',
            name: 'unknown',
            state: buildTerraformState('aws_subnet.unknown', {
              id: 'subnet-unknown',
            }),
          },
        },
      },
      edges: [
        {
          id: asEdgeId('edge-subnet-neighbor-vpc'),
          from: subnetFromNeighbor,
          to: vpcNodeId,
          attributes: {},
        },
        {
          id: asEdgeId('edge-subnet-unknown-subnet'),
          from: subnetUnknown,
          to: subnetFromReference,
          attributes: {},
        },
      ],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const tg = updated.toTgGraph() as TgGraph & {
      hints?: {
        topology?: {
          scopes?: Record<string, unknown>;
        };
      };
    };
    const scopes = tg.hints?.topology?.scopes ?? {};

    expect(scopes['vpc:vpc-inferred']).toBeDefined();
    expect(scopes['vpc:vpc-inferred:az:unknown:subnet:subnet-ref']).toBeDefined();
    expect(scopes['vpc:vpc-known:az:unknown:subnet:subnet-neighbor']).toBeDefined();
    expect(scopes['vpc:vpc-known:az:unknown:subnet:subnet-unknown']).not.toBeDefined();
  });

  it('shoud infer subnet vpc scopes from module path when subnet vpc ids are missing', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcId = asNodeId('resource.module.vpc.aws_vpc.this[0]');
    const subnetAId = asNodeId('resource.module.vpc.aws_subnet.private[0]');
    const subnetBId = asNodeId('resource.module.vpc.aws_subnet.private[1]');

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
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.['vpc:this[0]']).toBeDefined();
    expect(scopes?.['vpc:this[0]:az:eu-west-2a']).toBeDefined();
    expect(scopes?.['vpc:this[0]:az:eu-west-2a:subnet:private[0]']).toBeDefined();
    expect(scopes?.['vpc:this[0]:az:eu-west-2b']).toBeDefined();
    expect(scopes?.['vpc:this[0]:az:eu-west-2b:subnet:private[1]']).toBeDefined();
    expect(scopes?.['vpc:this[0]:az:eu-west-2a']).toMatchObject({
      layout: {
        mode: 'symmetric',
        groupId: 'vpc:this[0]:az-lanes',
        laneKey: 'eu-west-2a',
      },
    });
    expect(scopes?.['vpc:this[0]:az:eu-west-2b']).toMatchObject({
      layout: {
        mode: 'symmetric',
        groupId: 'vpc:this[0]:az-lanes',
        laneKey: 'eu-west-2b',
      },
    });
    expect(scopes?.['vpc:this[0]:az:eu-west-2a:subnet:private[0]']).toMatchObject({
      layout: {
        slotKey: 'private',
      },
    });
    expect(scopes?.['vpc:this[0]:az:eu-west-2b:subnet:private[1]']).toMatchObject({
      layout: {
        slotKey: 'private',
      },
    });
  });

  it('shoud normalize subnet slot keys by dropping az-like suffixes from subnet names', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetAId = asNodeId('resource.aws_subnet.private_a');
    const subnetBId = asNodeId('resource.aws_subnet.private_b');

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
            address: 'aws_subnet.private_a',
            resource: 'aws_subnet',
            name: 'private_a',
            state: buildTerraformState('aws_subnet.private_a', {
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
            address: 'aws_subnet.private_b',
            resource: 'aws_subnet',
            name: 'private_b',
            state: buildTerraformState('aws_subnet.private_b', {
              id: 'subnet-b',
              vpc_id: 'vpc-1',
              availability_zone: 'eu-west-2b',
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.['vpc:vpc-1:az:eu-west-2a:subnet:subnet-a']).toMatchObject({
      layout: {
        slotKey: 'private',
      },
    });
    expect(scopes?.['vpc:vpc-1:az:eu-west-2b:subnet:subnet-b']).toMatchObject({
      layout: {
        slotKey: 'private',
      },
    });
  });

  it('shoud infer vpc and subnet scopes from non-container references when vpc and subnet resources are absent', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const securityGroupId = asNodeId('resource.aws_security_group.external');
    const lambdaId = asNodeId('resource.aws_lambda_function.worker');
    const dbSubnetGroupId = asNodeId('resource.aws_db_subnet_group.external');
    const dbInstanceId = asNodeId('resource.aws_db_instance.external');

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
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.['vpc:vpc-external']).toBeDefined();
    expect(scopes?.['vpc:vpc-external:az:unknown']).toBeDefined();
    expect(scopes?.['vpc:vpc-external:az:unknown:subnet:subnet-ext-a']).toBeDefined();
    expect(scopes?.['vpc:vpc-external:az:unknown:subnet:subnet-ext-b']).toBeDefined();
  });

  it('shoud merge scopes into existing graph hints and tolerate missing nodes during traversal', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const firstNodeId = asNodeId('a');
    const missingNodeId = asNodeId('missing');
    const firstNode: TgGraph['nodes'][string] = {
      id: firstNodeId,
      terraform: {
        kind: 'resource',
        resource: 'aws_vpc',
        name: 'a',
        state: buildTerraformState('aws_vpc.a', {
          id: 'vpc-a',
        }),
      },
    };

    const adapter = {
      nodeIds: () => [firstNodeId, missingNodeId],
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === missingNodeId) {
          return undefined;
        }
        return firstNode;
      },
      predecessors: () => [],
      successors: () => [],
      getGraphHints: () => ({
        topology: {
          marker: true,
          scopes: {
            existing: {
              id: 'existing',
            },
          },
        },
      }),
      setGraphHints: (hints: unknown) => {
        const value = hints as {
          topology?: {
            marker?: boolean;
            scopes?: Record<string, unknown>;
          };
        };
        expect(value.topology?.marker).toBe(true);
        expect(value.topology?.scopes?.['vpc:vpc-a']).toBeDefined();
        return adapter;
      },
    } as unknown as AdapterOperations;

    const startNode = adapter.getNodeAttributes(firstNodeId);
    if (!startNode) {
      throw new Error('Expected start node');
    }

    rule.match(firstNodeId, startNode, adapter);
    const updated = rule.apply(firstNodeId, startNode, adapter);

    expect(updated).toBe(adapter);
  });

  it('shoud handle sparse state and duplicate inferred keys deterministically', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcAId = asNodeId('resource.aws_vpc.a');
    const vpcADupeId = asNodeId('resource.aws_vpc.a_dupe');
    const subnetId = asNodeId('resource.aws_subnet.a');
    const subnetDupeId = asNodeId('resource.aws_subnet.a_dupe');
    const sparseStateNodeId = asNodeId('resource.aws_subnet.sparse');

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
            state: buildTerraformState('aws_vpc.a', { id: 'vpc-a' }),
          },
        },
        [vpcADupeId]: {
          id: vpcADupeId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.a_dupe',
            resource: 'aws_vpc',
            name: 'a_dupe',
            state: buildTerraformState('aws_vpc.a_dupe', { id: 'vpc-a' }),
          },
        },
        [subnetId]: {
          id: subnetId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a',
            resource: 'aws_subnet',
            name: 'a',
            state: buildTerraformState('aws_subnet.a', {
              id: 'subnet-a',
              vpc_id: 'vpc-a',
            }),
          },
        },
        [subnetDupeId]: {
          id: subnetDupeId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.a_dupe',
            resource: 'aws_subnet',
            name: 'a_dupe',
            state: buildTerraformState('aws_subnet.a_dupe', {
              id: 'subnet-a',
              vpc_id: 'vpc-a',
            }),
          },
        },
        [sparseStateNodeId]: {
          id: sparseStateNodeId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.sparse',
            resource: 'aws_subnet',
            name: 'sparse',
            state: {
              source: 'state_show',
              effective: null,
              instances: [],
            },
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.['vpc:vpc-a']).toBeDefined();
    expect(scopes?.['vpc:vpc-a:az:unknown:subnet:subnet-a']).toBeDefined();
  });

  it('shoud fallback to name, address, and node id keys when state ids are missing', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcFromNameId = asNodeId('resource.aws_vpc.by_name');
    const vpcFromAddressId = asNodeId('resource.aws_vpc.by_address');
    const vpcFromNodeId = asNodeId('resource.aws_vpc.by_nodeid');
    const subnetFromNameId = asNodeId('resource.aws_subnet.by_name');
    const subnetFromAddressId = asNodeId('resource.aws_subnet.by_address');
    const subnetFromNodeId = asNodeId('resource.aws_subnet.by_nodeid');

    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [vpcFromNameId]: {
          id: vpcFromNameId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.by_name',
            resource: 'aws_vpc',
            name: 'by-name',
            state: buildTerraformState('aws_vpc.by_name', {}),
          },
        },
        [vpcFromAddressId]: {
          id: vpcFromAddressId,
          terraform: {
            kind: 'resource',
            address: 'aws_vpc.by_address',
            resource: 'aws_vpc',
            name: ' ',
            state: buildTerraformState('aws_vpc.by_address', {}),
          },
        },
        [vpcFromNodeId]: {
          id: vpcFromNodeId,
          terraform: {
            kind: 'resource',
            address: ' ',
            resource: 'aws_vpc',
            name: ' ',
            state: buildTerraformState('aws_vpc.by_nodeid', {}),
          },
        },
        [subnetFromNameId]: {
          id: subnetFromNameId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.by_name',
            resource: 'aws_subnet',
            name: 'subnet-by-name',
            state: buildTerraformState('aws_subnet.by_name', {
              vpc_id: 'by-name',
            }),
          },
        },
        [subnetFromAddressId]: {
          id: subnetFromAddressId,
          terraform: {
            kind: 'resource',
            address: 'aws_subnet.by_address',
            resource: 'aws_subnet',
            name: ' ',
            state: buildTerraformState('aws_subnet.by_address', {
              vpc_id: 'aws_vpc.by_address',
            }),
          },
        },
        [subnetFromNodeId]: {
          id: subnetFromNodeId,
          terraform: {
            kind: 'resource',
            address: ' ',
            resource: 'aws_subnet',
            name: ' ',
            state: buildTerraformState('aws_subnet.by_nodeid', {
              vpc_id: String(vpcFromNodeId),
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.['vpc:by-name']).toBeDefined();
    expect(scopes?.['vpc:aws_vpc.by_address']).toBeDefined();
    expect(scopes?.[`vpc:${String(vpcFromNodeId)}`]).toBeDefined();

    expect(scopes?.['vpc:by-name:az:unknown:subnet:subnet-by-name']).toBeDefined();
    expect(
      scopes?.['vpc:aws_vpc.by_address:az:unknown:subnet:aws_subnet.by_address'],
    ).toBeDefined();
    expect(
      scopes?.[`vpc:${String(vpcFromNodeId)}:az:unknown:subnet:aws_subnet.by_nodeid`],
    ).toBeDefined();
  });

  it('shoud attach inferred subnet references to referenced vpc ids', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const lambdaId = asNodeId('resource.aws_lambda_function.inferred');
    const adapter = buildAdapter({
      schemaVersion: TG_SCHEMA_VERSION,
      description: {},
      nodes: {
        [lambdaId]: {
          id: lambdaId,
          terraform: {
            kind: 'resource',
            address: 'aws_lambda_function.inferred',
            resource: 'aws_lambda_function',
            name: 'inferred',
            state: buildTerraformState('aws_lambda_function.inferred', {
              vpc_id: 'vpc-ref',
              subnet_ids: ['subnet-ref'],
            }),
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.['vpc:vpc-ref']).toBeDefined();
    expect(scopes?.['vpc:vpc-ref:az:unknown:subnet:subnet-ref']).toBeDefined();
  });

  it('shoud infer missing vpc identifier mappings from subnet vpc references', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    let readCount = 0;
    const values = {
      id: 'subnet-dynamic',
      get vpc_id() {
        readCount += 1;
        // resolveReferencedVpcIds reads vpc_id before subnet-specific parsing.
        // Return undefined for those reads, then expose the id for subnet.vpcReferences.
        return readCount <= 2 ? undefined : 'vpc-dynamic';
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
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.['vpc:vpc-dynamic']).toBeDefined();
    expect(scopes?.['vpc:vpc-dynamic:az:unknown:subnet:subnet-dynamic']).toBeDefined();
  });

  it('shoud tolerate subnet nodes disappearing after the indexing pass', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.main');
    const subnetId = asNodeId('resource.aws_subnet.ephemeral');
    const vpcNode: TgGraph['nodes'][string] = {
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
    };
    const subnetNode: TgGraph['nodes'][string] = {
      id: subnetId,
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
      nodeIds: () => [subnetId, vpcId],
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === vpcId) {
          return vpcNode;
        }
        if (nodeId !== subnetId) {
          return undefined;
        }

        subnetLookups += 1;
        return subnetLookups <= 2 ? subnetNode : undefined;
      },
      predecessors: () => [],
      successors: () => [],
      getGraphHints: () => undefined,
      setGraphHints: () => adapter,
    } as unknown as AdapterOperations;

    const startNode = adapter.getNodeAttributes(subnetId);
    if (!startNode) {
      throw new Error('Expected start node');
    }

    rule.match(subnetId, startNode, adapter);
    const updated = rule.apply(subnetId, startNode, adapter);
    expect(updated).toBe(adapter);
  });

  it('shoud fallback subnet key to node id when id name address and terraform address are unavailable', () => {
    const [rule] = buildRules();
    if (!rule) {
      throw new Error('Expected topology rule');
    }

    const vpcId = asNodeId('resource.aws_vpc.singleton');
    const subnetId = asNodeId('resource.aws_subnet.key_from_nodeid');

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
            address: ' ',
            resource: 'aws_subnet',
            name: ' ',
            state: {
              source: 'state_show',
              effective: null,
              instances: [],
            },
          },
        },
      },
      edges: [],
    });

    const updated = applyRuleAcrossNodes(rule, adapter);
    const scopes = (
      updated.toTgGraph() as TgGraph & {
        hints?: {
          topology?: {
            scopes?: Record<string, unknown>;
          };
        };
      }
    ).hints?.topology?.scopes;

    expect(scopes?.[`vpc:vpc-singleton:az:unknown:subnet:${String(subnetId)}`]).toBeDefined();
    expect(scopes?.[`vpc:vpc-singleton:az:unknown:subnet:${String(subnetId)}`]).toMatchObject({
      layout: {
        slotKey: String(subnetId),
      },
    });
  });
});
