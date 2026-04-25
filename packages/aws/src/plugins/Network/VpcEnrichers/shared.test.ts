import type { AdapterOperations } from '@terra-graph/core';
import { addSubnetIdentifier, toModulePathCandidates } from './shared.js';
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
});
