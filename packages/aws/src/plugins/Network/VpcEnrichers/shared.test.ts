import { type AdapterOperations, type NodeId, asNodeId } from '@terra-graph/core';
import {
  addSubnetIdentifier,
  resolveReferencedSubnetGroupIds,
  resolveReferencedSubnetIds,
  resolveSubnetsFromGroupByName,
  toModulePathCandidates,
} from './shared.js';
import type { PlacementContext } from './types.js';

const buildContext = (): PlacementContext => ({
  graph: {} as AdapterOperations,
  vpcs: new Map(),
  subnets: new Map(),
  vpcModulePathToKeys: new Map(),
  vpcIdentifierToKey: new Map(),
  subnetIdentifierToKey: new Map(),
  vpcNodeToKey: new Map(),
  subnetNodeToKey: new Map(),
  groupNameToNodeId: new Map(),
});

describe('VpcEnrichers/shared', () => {
  it('shoud skip non-module path segments when building module candidates', () => {
    expect(toModulePathCandidates('module.core.resource.vpc')).toStrictEqual(['module.core']);
  });

  it('shoud infer explicit vpc mappings when adding subnet identifiers', () => {
    const context = buildContext();
    const subnetKeys = new Set<string>();

    addSubnetIdentifier('subnet-explicit', context, subnetKeys, 'vpc-explicit');

    expect(subnetKeys.has('subnet-explicit')).toBe(true);
    expect(context.vpcIdentifierToKey.get('vpc-explicit')).toBe('vpc-explicit');
    expect(context.vpcs.get('vpc-explicit')).toStrictEqual({
      key: 'vpc-explicit',
      label: 'vpc-explicit',
    });
    expect(context.subnets.get('subnet-explicit')?.vpcKey).toBe('vpc-explicit');
  });

  it('shoud resolve nested subnet-group identifiers from plural fields', () => {
    expect(
      resolveReferencedSubnetGroupIds({
        groups: [
          {
            subnet_group_names: ['db-a', 'db-b'],
          },
          {
            nested: {
              cache_subnet_group_ids: ['cache-a'],
            },
          },
        ],
      }),
    ).toEqual(expect.arrayContaining(['db-a', 'db-b', 'cache-a']));
  });

  it('shoud safely walk cyclic nested values when resolving subnet ids', () => {
    const cyclic: Record<string, unknown> = {
      subnet_id: 'subnet-primary',
    };
    cyclic.self = cyclic;

    expect(resolveReferencedSubnetIds(cyclic)).toEqual(expect.arrayContaining(['subnet-primary']));
  });

  it('shoud return empty subnets when group name is absent or unknown', () => {
    const context = buildContext();

    expect(resolveSubnetsFromGroupByName('network.group', undefined, context)).toStrictEqual(
      new Set<string>(),
    );
    expect(resolveSubnetsFromGroupByName('network.group', 'missing', context)).toStrictEqual(
      new Set<string>(),
    );
  });

  it('shoud resolve subnet keys from a mapped group node and subnet neighbors', () => {
    const groupNodeId = asNodeId('resource.aws_db_subnet_group.this');
    const subnetNodeId = asNodeId('resource.aws_subnet.a');

    const context: PlacementContext = {
      ...buildContext(),
      graph: {
        predecessors: () => [],
        successors: (nodeId: NodeId) => (nodeId === groupNodeId ? [subnetNodeId] : []),
      } as unknown as AdapterOperations,
      subnetNodeToKey: new Map([[String(subnetNodeId), 'subnet-a']]),
      groupNameToNodeId: new Map([['network.group', new Map([['db-subnets', groupNodeId]])]]),
    };

    expect(resolveSubnetsFromGroupByName('network.group', 'db-subnets', context)).toStrictEqual(
      new Set(['subnet-a']),
    );
  });
});
