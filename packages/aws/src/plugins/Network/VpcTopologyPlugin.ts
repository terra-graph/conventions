import {
  type AdapterOperations,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  type NodeId,
  NodeRule,
  type TgGraphHints,
  type TgNodeAttributes,
  type TgTopologyScope,
} from '@terra-graph/core';
import { pluginId } from '../../namespaces.js';
import {
  resolveReferencedSubnetIds,
  resolveReferencedVpcIds,
  resolveUniqueVpcKeyFromModulePath,
  toModulePath,
  toTerraformAddress,
} from './VpcEnrichers/shared.js';

const VPC_RESOURCE = 'aws_vpc';
const SUBNET_RESOURCE = 'aws_subnet';

type VpcTopologyPluginOptions = Record<string, never>;

type VpcInfo = {
  key: string;
  label: string;
};

type SubnetInfo = {
  key: string;
  label: string;
  name?: string;
  address?: string;
  nodeId?: NodeId;
  availabilityZone?: string;
  vpcReferences: Set<string>;
  vpcKey?: string;
};

type ResolvedTopology = {
  scopes: Record<string, TgTopologyScope>;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const toStringValue = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const readStateValues = (node: TgNodeAttributes): Record<string, unknown> => {
  const state = node.terraform?.state;
  const effective = state?.effective;
  if (!effective || !isObjectRecord(effective.values)) {
    return {};
  }

  return effective.values;
};

const buildVpcScopeId = (vpcKey: string): string => `vpc:${vpcKey}`;
const buildVpcAzScopeId = (vpcKey: string, az: string): string =>
  `${buildVpcScopeId(vpcKey)}:az:${az}`;
const buildSubnetScopeId = (vpcKey: string, az: string, subnetKey: string): string =>
  `${buildVpcAzScopeId(vpcKey, az)}:subnet:${subnetKey}`;
const buildVpcAzLaneGroupId = (vpcKey: string): string => `${buildVpcScopeId(vpcKey)}:az-lanes`;

const resolveSubnetSlotKeyCandidate = (value: string | undefined): string | undefined => {
  const candidate = toStringValue(value)?.toLowerCase();
  if (!candidate) {
    return undefined;
  }

  /* istanbul ignore next -- split on a non-empty string always yields at least one segment */
  const segment = candidate.split('.').at(-1) ?? candidate;
  const strippedIndex = segment.replace(/\[\d+\]$/g, '');
  const tokens = strippedIndex.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
  if (tokens.length < 2) {
    return strippedIndex;
  }

  /* istanbul ignore next -- tokens.length >= 2 here, so the last token is always defined */
  const lastToken = tokens[tokens.length - 1] ?? '';
  if (
    /^[a-z]$/.test(lastToken) ||
    /^\d+$/.test(lastToken) ||
    /^\d+[a-z]$/.test(lastToken) ||
    /^az\d+$/.test(lastToken)
  ) {
    return tokens.slice(0, -1).join('_');
  }

  return strippedIndex;
};

const resolveSubnetSlotKey = (subnet: SubnetInfo): string => {
  return (
    resolveSubnetSlotKeyCandidate(subnet.name) ??
    resolveSubnetSlotKeyCandidate(subnet.address) ??
    subnet.key
  );
};

class ApplyVpcTopologyHints extends NodeRule {
  public override apply(
    nodeId: NodeId,
    _node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const firstNodeId = [...graph.nodeIds()]
      .map((id) => String(id))
      .sort((left, right) => left.localeCompare(right))[0];

    if (!firstNodeId || String(nodeId) !== firstNodeId) {
      return graph;
    }

    const resolved = this.resolveTopology(graph);
    const existingHints = graph.getGraphHints() ?? {};
    const existingTopology = isObjectRecord(existingHints.topology) ? existingHints.topology : {};
    const nextHints: TgGraphHints = {
      ...existingHints,
      topology: {
        ...existingTopology,
        scopes: resolved.scopes,
      },
    };

    return graph.setGraphHints(nextHints);
  }

  private resolveTopology(graph: AdapterOperations): ResolvedTopology {
    const vpcs = new Map<string, VpcInfo>();
    const subnets = new Map<string, SubnetInfo>();
    const vpcModulePathToKeys = new Map<string, Set<string>>();
    const vpcIdentifierToKey = new Map<string, string>();
    const vpcNodeToKey = new Map<string, string>();

    const ensureVpc = (key: string, label: string): VpcInfo => {
      const existing = vpcs.get(key);
      if (existing) {
        return existing;
      }

      const created: VpcInfo = {
        key,
        label,
      };
      vpcs.set(key, created);
      return created;
    };

    const ensureSubnet = (key: string, label: string): SubnetInfo => {
      const existing = subnets.get(key);
      if (existing) {
        return existing;
      }

      const created: SubnetInfo = {
        key,
        label,
        vpcReferences: new Set<string>(),
      };
      subnets.set(key, created);
      return created;
    };

    const linkVpcIdentifier = (identifier: string | undefined, key: string) => {
      if (!identifier) {
        return;
      }
      vpcIdentifierToKey.set(identifier, key);
    };

    for (const currentNodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(currentNodeId);
      if (!node) {
        continue;
      }

      const resource = toStringValue(node.terraform?.resource);
      const address = toStringValue(node.terraform?.address);
      const terraformAddress = toTerraformAddress(node);
      const modulePath = toModulePath(terraformAddress);
      const name = toStringValue(node.terraform?.name);
      const values = readStateValues(node);
      const referencedVpcIds = resolveReferencedVpcIds(values);
      const referencedSubnetIds = resolveReferencedSubnetIds(values);

      for (const vpcId of referencedVpcIds) {
        ensureVpc(vpcId, vpcId);
        linkVpcIdentifier(vpcId, vpcId);
      }

      for (const subnetId of referencedSubnetIds) {
        const inferredSubnet = ensureSubnet(subnetId, subnetId);
        for (const vpcId of referencedVpcIds) {
          inferredSubnet.vpcReferences.add(vpcId);
        }
      }

      if (resource === VPC_RESOURCE) {
        const vpcId = toStringValue(values.id);
        const vpcKey = vpcId ?? name ?? address ?? String(currentNodeId);
        ensureVpc(vpcKey, vpcId ?? name ?? vpcKey);
        linkVpcIdentifier(vpcId, vpcKey);
        linkVpcIdentifier(name, vpcKey);
        linkVpcIdentifier(address, vpcKey);
        linkVpcIdentifier(terraformAddress, vpcKey);
        linkVpcIdentifier(String(currentNodeId), vpcKey);
        vpcNodeToKey.set(String(currentNodeId), vpcKey);

        if (modulePath) {
          const existingVpcKeys = vpcModulePathToKeys.get(modulePath) ?? new Set<string>();
          existingVpcKeys.add(vpcKey);
          vpcModulePathToKeys.set(modulePath, existingVpcKeys);
        }
      }

      if (resource === SUBNET_RESOURCE) {
        const subnetId = toStringValue(values.id);
        const subnetKey = subnetId ?? name ?? address ?? terraformAddress ?? String(currentNodeId);
        const subnet = ensureSubnet(subnetKey, subnetId ?? name ?? subnetKey);
        subnet.name = name ?? subnet.name;
        subnet.address = terraformAddress ?? address ?? subnet.address;
        subnet.nodeId = currentNodeId;
        subnet.availabilityZone =
          toStringValue(values.availability_zone) ?? subnet.availabilityZone;
        const referencedVpcId = toStringValue(values.vpc_id);
        if (referencedVpcId) {
          subnet.vpcReferences.add(referencedVpcId);
        }
      }
    }

    for (const subnet of subnets.values()) {
      const referencedVpcKeys = [...subnet.vpcReferences].map((vpcReference) => {
        const existing = vpcIdentifierToKey.get(vpcReference);
        if (existing) {
          return existing;
        }

        const inferred = ensureVpc(vpcReference, vpcReference);
        linkVpcIdentifier(vpcReference, inferred.key);
        return inferred.key;
      });

      const uniqueReferencedVpcKeys = [...new Set(referencedVpcKeys)];
      if (uniqueReferencedVpcKeys.length === 1) {
        subnet.vpcKey = uniqueReferencedVpcKeys[0];
        continue;
      }

      if (!subnet.nodeId) {
        if (vpcs.size === 1) {
          subnet.vpcKey = [...vpcs.keys()][0];
        }
        continue;
      }

      const neighborVpcKeys = this.resolveNeighborVpcKeys(
        subnet.nodeId as NodeId,
        graph,
        vpcNodeToKey,
      );
      if (neighborVpcKeys.size === 1) {
        subnet.vpcKey = [...neighborVpcKeys][0];
        continue;
      }

      const subnetNode = graph.getNodeAttributes(subnet.nodeId as NodeId);
      if (!subnetNode) {
        continue;
      }

      const moduleVpcKey = resolveUniqueVpcKeyFromModulePath(
        toModulePath(toTerraformAddress(subnetNode)),
        vpcModulePathToKeys,
      );
      if (moduleVpcKey) {
        subnet.vpcKey = moduleVpcKey;
      } else if (vpcs.size === 1) {
        subnet.vpcKey = [...vpcs.keys()][0];
      }
    }

    const scopes: ResolvedTopology['scopes'] = {};
    let order = 1;
    const sortedVpcKeys = [...vpcs.keys()].sort((left, right) => left.localeCompare(right));
    for (const vpcKey of sortedVpcKeys) {
      const vpcScopeId = buildVpcScopeId(vpcKey);
      scopes[vpcScopeId] = {
        id: vpcScopeId,
        // biome-ignore lint/style/noNonNullAssertion: key exists in this loop
        label: vpcs.get(vpcKey)!.label,
        order: order++,
        layout: {
          direction: 'horizontal',
        } as TgTopologyScope['layout'],
      };

      const vpcSubnets = [...subnets.values()]
        .filter((subnet) => subnet.vpcKey === vpcKey)
        .sort((left, right) => left.key.localeCompare(right.key));

      const azNames = [
        ...new Set(vpcSubnets.map((subnet) => subnet.availabilityZone ?? 'unknown')),
      ].sort((left, right) => left.localeCompare(right));

      for (const az of azNames) {
        const azScopeId = buildVpcAzScopeId(vpcKey, az);
        scopes[azScopeId] = {
          id: azScopeId,
          parentId: vpcScopeId,
          label: az,
          order: order++,
          layout: {
            direction: 'vertical',
            mode: 'symmetric',
            groupId: buildVpcAzLaneGroupId(vpcKey),
            laneKey: az,
          } as TgTopologyScope['layout'],
        };

        const azSubnets = vpcSubnets
          .filter((subnet) => (subnet.availabilityZone ?? 'unknown') === az)
          .sort((left, right) => left.key.localeCompare(right.key));

        for (const subnet of azSubnets) {
          const subnetScopeId = buildSubnetScopeId(vpcKey, az, subnet.key);
          scopes[subnetScopeId] = {
            id: subnetScopeId,
            parentId: azScopeId,
            label: subnet.label,
            order: order++,
            layout: {
              slotKey: resolveSubnetSlotKey(subnet),
            },
          };
        }
      }
    }

    return { scopes };
  }

  private resolveNeighborVpcKeys(
    nodeId: NodeId,
    graph: AdapterOperations,
    vpcNodeToKey: Map<string, string>,
  ): Set<string> {
    const neighbors = new Set<NodeId>([...graph.predecessors(nodeId), ...graph.successors(nodeId)]);

    const vpcKeys = new Set<string>();
    for (const neighborId of neighbors) {
      const vpcKey = vpcNodeToKey.get(String(neighborId));
      if (vpcKey) {
        vpcKeys.add(vpcKey);
      }
    }

    return vpcKeys;
  }
}

export class VpcTopologyPlugin extends GraphPlugin<VpcTopologyPluginOptions> {
  static id = pluginId(`aws.${VpcTopologyPlugin.name}`);

  constructor() {
    super(VpcTopologyPlugin.id, {});
  }

  public override build(
    _input: GraphPluginBuildInput<VpcTopologyPluginOptions>,
  ): GraphPluginBuildResult {
    return {
      phases: [
        {
          phase: 'normalize',
          rules: [
            new ApplyVpcTopologyHints({
              node: {
                any: true,
              },
            }),
          ],
        },
      ],
    };
  }
}

NodeRule.register(ApplyVpcTopologyHints);
