import { type AdapterOperations, type TgNodeAttributes, asNodeId } from '@terra-graph/core';
import type { PlacementContext } from '../types.js';
import { NetworkPlacementEnricher } from './network.js';

const buildContext = (graph: AdapterOperations): PlacementContext => ({
  graph,
  vpcs: new Map(),
  subnets: new Map(),
  vpcModulePathToKeys: new Map(),
  vpcIdentifierToKey: new Map(),
  subnetIdentifierToKey: new Map(),
  vpcNodeToKey: new Map(),
  subnetNodeToKey: new Map(),
  groupNameToNodeId: new Map(),
});

describe('NetworkPlacementEnricher', () => {
  it('shoud no-op indexing when a node resource type is unavailable', () => {
    const context = buildContext({} as AdapterOperations);
    NetworkPlacementEnricher.indexNode?.({
      nodeId: asNodeId('resource.missing'),
      node: {} as TgNodeAttributes,
      values: {},
      context,
      resource: undefined,
      address: undefined,
      name: undefined,
    });

    expect(context.groupNameToNodeId.size).toBe(0);
  });

  it('shoud resolve explicit and neighbor placement metadata while tolerating missing references', () => {
    const aclNodeId = asNodeId('resource.aws_network_acl.main');
    const missingNodeId = asNodeId('resource.missing');
    const subnetNeighborId = asNodeId('resource.aws_subnet.neighbor');
    const vpcNeighborId = asNodeId('resource.aws_vpc.neighbor');

    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === aclNodeId) {
          return {
            terraform: {
              state: {
                effective: {
                  values: {},
                },
              },
            },
          } as TgNodeAttributes;
        }
        return undefined;
      },
      predecessors: (nodeId: string) => (nodeId === aclNodeId ? [subnetNeighborId] : []),
      successors: (nodeId: string) => (nodeId === aclNodeId ? [vpcNeighborId] : []),
    } as unknown as AdapterOperations;

    const context = buildContext(graph);
    context.groupNameToNodeId.set(
      'network.security_group',
      new Map([['sg-missing', missingNodeId]]),
    );
    context.groupNameToNodeId.set('network.network_acl', new Map([['acl-main', aclNodeId]]));
    context.subnetNodeToKey.set(String(subnetNeighborId), 'subnet-neighbor');
    context.vpcNodeToKey.set(String(vpcNeighborId), 'vpc-neighbor');

    const subnetKeys = new Set<string>();
    const vpcKeys = new Set<string>();

    NetworkPlacementEnricher.apply({
      nodeId: asNodeId('resource.aws_vpc_security_group_ingress_rule.test'),
      node: {} as TgNodeAttributes,
      values: {
        vpc_id: 'vpc-explicit',
        security_group_id: 'sg-missing',
        route_table_id: 'rt-missing',
        network_acl_id: 'acl-main',
      },
      context,
      subnetKeys,
      vpcKeys,
      explicitVpcId: undefined,
    });

    expect(vpcKeys).toStrictEqual(new Set<string>(['vpc-explicit', 'vpc-neighbor']));
    expect(subnetKeys).toStrictEqual(new Set<string>(['subnet-neighbor']));
    expect(context.vpcs.get('vpc-explicit')).toStrictEqual({
      key: 'vpc-explicit',
      label: 'vpc-explicit',
    });
    expect(context.vpcIdentifierToKey.get('vpc-explicit')).toBe('vpc-explicit');
  });
});
