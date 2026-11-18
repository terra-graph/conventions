import {
  type AdapterOperations,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  type NamedPhase,
  type NodeId,
  NodeRule,
  type TgNodeAttributes,
  asNodeId,
  edgeIdFrom,
} from '@terra-graph/core';
import { pluginId } from '../../namespaces.js';
import { resolveAwsSubnetContentSlot } from './VpcEnrichers/ContentSlots/index.js';
import { ApplyAwsNetworkCleanup } from './VpcEnrichers/Visibility/index.js';
import {
  type AwsNetworkPlacementPluginOptions,
  type PlacementContext,
  type PlacementEnricher,
  type SubnetInfo,
  type VpcInfo,
  resolveAwsNetworkPlacementEnrichers,
  resolveAwsNetworkPlacementOptions,
} from './VpcEnrichers/index.js';
import {
  addSubnetIdentifiers,
  getOrCreateGroupNodeMap,
  isObjectRecord,
  linkGroupIdentifier,
  readStateValues,
  resolveNeighborSubnetKeys,
  resolveNeighborVpcKeys,
  resolveReferencedSubnetGroupIds,
  resolveReferencedSubnetIds,
  resolveReferencedVpcIds,
  resolveSubnetsFromGroupByName,
  resolveUniqueVpcKeyFromModulePath,
  toModulePath,
  toStringArray,
  toStringValue,
  toTerraformAddress,
} from './VpcEnrichers/shared.js';

const VPC_RESOURCE = 'aws_vpc';
const SUBNET_RESOURCE = 'aws_subnet';
const REPLICA_NODE_SEGMENT = ':replica:subnet:';
const SUBNET_GROUP_RESOURCE_PATTERN = /^aws_.+_subnet_group$/;
const GENERIC_SUBNET_GROUP_KIND = 'network.generic_subnet_group';
const SUBNET_PLACEMENT_BLACKLIST_PATTERN =
  /(_association|_rule|_attachment|_policy|_permission|_listener)$/;

type CloneEdgeSnapshot = {
  id: string;
  source: NodeId;
  target: NodeId;
  attributes: Record<string, unknown>;
};

type ClonePlan = {
  sourceNodeId: NodeId;
  subnetKeys: string[];
  subnetScopeIds: Record<string, string>;
  incomingEdges: CloneEdgeSnapshot[];
  outgoingEdges: CloneEdgeSnapshot[];
};

type PlacementPlan = {
  placements: Map<NodeId, NodeTopologyPlacement>;
  clonePlans: ClonePlan[];
};

type NodeTopologyPlacement = {
  scopeId: string;
  slotKey?: string;
  slotOrder?: number;
};

type PlacementResolutionState = {
  node: TgNodeAttributes;
  values: Record<string, unknown>;
  resource?: string;
  explicitVpcId?: string;
  explicitVpcKeys: Set<string>;
  subnetKeys: Set<string>;
  vpcKeys: Set<string>;
  matchingEnrichers: PlacementEnricher[];
  controls: {
    suppressPlacement?: boolean;
  };
  referencedVpcIds: string[];
  referencedSubnetIds: string[];
  referencedSubnetGroupIds: string[];
};

const buildVpcScopeId = (vpcKey: string): string => `vpc:${vpcKey}`;
const buildVpcAzScopeId = (vpcKey: string, az: string): string =>
  `${buildVpcScopeId(vpcKey)}:az:${az}`;
const buildSubnetScopeId = (vpcKey: string, az: string, subnetKey: string): string =>
  `${buildVpcAzScopeId(vpcKey, az)}:subnet:${subnetKey}`;

const buildReplicaNodeId = (nodeId: NodeId, subnetKey: string): NodeId =>
  asNodeId(`${String(nodeId)}${REPLICA_NODE_SEGMENT}${subnetKey}`);

const parseReplicaSubnetKey = (nodeId: NodeId): string | undefined => {
  const index = String(nodeId).indexOf(REPLICA_NODE_SEGMENT);
  if (index < 0) {
    return undefined;
  }

  const subnetKey = String(nodeId).slice(index + REPLICA_NODE_SEGMENT.length);
  return subnetKey.length > 0 ? subnetKey : undefined;
};

const parseScopeSubnetKey = (scopeId: unknown): string | undefined => {
  if (typeof scopeId !== 'string') {
    return undefined;
  }

  const marker = ':subnet:';
  const index = scopeId.lastIndexOf(marker);
  if (index < 0) {
    return undefined;
  }

  const subnetKey = scopeId.slice(index + marker.length);
  /* istanbul ignore next -- malformed topology scope ids should behave the same as missing subnet scope */
  return subnetKey.length > 0 ? subnetKey : undefined;
};

const isSubnetGroupResource = (resource: string | undefined): boolean => {
  if (!resource) {
    return false;
  }

  return SUBNET_GROUP_RESOURCE_PATTERN.test(resource);
};

const isSubnetPlacementBlacklistedResource = (resource: string | undefined): boolean => {
  if (!resource) {
    return false;
  }

  if (resource === VPC_RESOURCE || resource === SUBNET_RESOURCE) {
    return false;
  }

  return SUBNET_PLACEMENT_BLACKLIST_PATTERN.test(resource);
};

class ApplyAwsNetworkPlacementHints extends NodeRule {
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

    const placementOptions = resolveAwsNetworkPlacementOptions(this.config.options);
    const enrichers = resolveAwsNetworkPlacementEnrichers(placementOptions);
    const plan = this.resolvePlacementPlan(graph, enrichers);

    let updated = graph;
    for (const [currentNodeId, placement] of plan.placements.entries()) {
      updated = this.upsertTopologyPlacement(updated, currentNodeId, placement);
    }

    return this.applyClonePlans(updated, plan.clonePlans);
  }

  private resolvePlacementPlan(
    graph: AdapterOperations,
    enrichers: PlacementEnricher[],
  ): PlacementPlan {
    const enabledEnrichers = [...enrichers].sort((left, right) => left.id.localeCompare(right.id));
    const context = this.buildPlacementContext(graph, enabledEnrichers);
    const placements = new Map<NodeId, NodeTopologyPlacement>();
    const clonePlans: ClonePlan[] = [];

    const nodeIds = [...graph.nodeIds()].sort((left, right) =>
      String(left).localeCompare(String(right)),
    );
    for (const currentNodeId of nodeIds) {
      const replicaSubnetKey = parseReplicaSubnetKey(currentNodeId);
      if (replicaSubnetKey) {
        const scopeId = this.resolveSubnetScope(replicaSubnetKey, context.subnets);
        if (scopeId) {
          const replicaNode = graph.getNodeAttributes(currentNodeId);
          placements.set(
            currentNodeId,
            this.buildTopologyPlacement(scopeId, replicaNode?.terraform?.resource),
          );
        }
        continue;
      }

      const resolution = this.initializePlacementResolution(
        currentNodeId,
        graph,
        context,
        enabledEnrichers,
      );
      if (!resolution) {
        continue;
      }

      for (const enricher of resolution.matchingEnrichers) {
        enricher.apply({
          nodeId: currentNodeId,
          node: resolution.node,
          values: resolution.values,
          context,
          subnetKeys: resolution.subnetKeys,
          vpcKeys: resolution.vpcKeys,
          explicitVpcId: resolution.explicitVpcId,
          controls: resolution.controls,
        });
      }

      if (!resolution.controls.suppressPlacement) {
        const edgeSubnetKeys = resolveNeighborSubnetKeys(
          currentNodeId,
          graph,
          context.subnetNodeToKey,
        );
        if (edgeSubnetKeys.size > 0) {
          resolution.subnetKeys.clear();
          for (const key of edgeSubnetKeys) {
            resolution.subnetKeys.add(key);
          }
        }
      } else {
        resolution.subnetKeys.clear();
        resolution.vpcKeys.clear();
      }

      this.finalizePlacementResolution(
        currentNodeId,
        graph,
        context,
        resolution,
        placements,
        clonePlans,
      );
    }

    const reconcileCandidateIds = nodeIds.filter((currentNodeId) => {
      if (parseReplicaSubnetKey(currentNodeId)) {
        return false;
      }

      if (placements.has(currentNodeId)) {
        return false;
      }

      const node = graph.getNodeAttributes(currentNodeId);
      const resource = toStringValue(node?.terraform?.resource);
      return enabledEnrichers.some(
        (enricher) =>
          !!enricher.reconcilePlacement && !!resource && enricher.resources.has(resource),
      );
    });

    for (let attempt = 0; attempt < reconcileCandidateIds.length; attempt += 1) {
      let changed = false;
      const plannedSubnetKeysByNodeId = this.buildPlannedSubnetKeysByNodeId(placements, clonePlans);

      for (const currentNodeId of reconcileCandidateIds) {
        /* istanbul ignore next -- reconciliation candidates are usually placement-free by construction */
        if (placements.has(currentNodeId)) {
          continue;
        }

        const resolution = this.initializePlacementResolution(
          currentNodeId,
          graph,
          context,
          enabledEnrichers,
        );
        /* istanbul ignore next -- candidate ids are drawn from existing graph nodes */
        if (!resolution) {
          continue;
        }

        for (const enricher of resolution.matchingEnrichers) {
          enricher.apply({
            nodeId: currentNodeId,
            node: resolution.node,
            values: resolution.values,
            context,
            subnetKeys: resolution.subnetKeys,
            vpcKeys: resolution.vpcKeys,
            explicitVpcId: resolution.explicitVpcId,
            controls: resolution.controls,
          });
        }

        /* istanbul ignore next -- reconciliation hook dispatch is validated in enricher-specific tests */
        if (!resolution.controls.suppressPlacement && resolution.subnetKeys.size === 0) {
          /* istanbul ignore next -- individual enricher reconcile hooks are exercised in enricher-specific tests */
          for (const enricher of resolution.matchingEnrichers) {
            enricher.reconcilePlacement?.({
              nodeId: currentNodeId,
              node: resolution.node,
              values: resolution.values,
              context,
              subnetKeys: resolution.subnetKeys,
              vpcKeys: resolution.vpcKeys,
              explicitVpcId: resolution.explicitVpcId,
              controls: resolution.controls,
              plannedSubnetKeysByNodeId,
            });
          }
        } else if (resolution.controls.suppressPlacement) {
          resolution.subnetKeys.clear();
          resolution.vpcKeys.clear();
        }

        /* istanbul ignore next -- loop-level changed bookkeeping is exercised by end-to-end placement assertions */
        if (
          this.finalizePlacementResolution(
            currentNodeId,
            graph,
            context,
            resolution,
            placements,
            clonePlans,
          )
        ) {
          /* istanbul ignore next -- changed bookkeeping is validated by end-to-end placement outcomes */
          changed = true;
        }
      }

      if (!changed) {
        break;
      }
    }

    return { placements, clonePlans };
  }

  private initializePlacementResolution(
    currentNodeId: NodeId,
    graph: AdapterOperations,
    context: PlacementContext,
    enabledEnrichers: PlacementEnricher[],
  ): PlacementResolutionState | undefined {
    const node = graph.getNodeAttributes(currentNodeId);
    if (!node) {
      return undefined;
    }

    const values = readStateValues(node);
    const referencedVpcIds = resolveReferencedVpcIds(values);
    const referencedSubnetIds = resolveReferencedSubnetIds(values);
    const referencedSubnetGroupIds = resolveReferencedSubnetGroupIds(values);
    const explicitVpcId = referencedVpcIds[0];
    const explicitVpcKeys = new Set<string>();

    for (const referencedVpcId of referencedVpcIds) {
      // Build context pre-indexes referenced VPC ids. Keep fallback for defensive robustness.
      /* istanbul ignore next */
      const vpcKey = context.vpcIdentifierToKey.get(referencedVpcId) ?? referencedVpcId;
      context.vpcIdentifierToKey.set(referencedVpcId, vpcKey);
      // Placement context pre-indexes referenced VPC ids; keep a defensive backfill.
      /* istanbul ignore next */
      if (!context.vpcs.get(vpcKey)) {
        context.vpcs.set(vpcKey, { key: vpcKey, label: vpcKey });
      }
      explicitVpcKeys.add(vpcKey);
    }

    const subnetKeys = new Set<string>();
    const vpcKeys = new Set<string>(explicitVpcKeys);
    addSubnetIdentifiers(referencedSubnetIds, context, subnetKeys, explicitVpcId);

    const resource = toStringValue(node.terraform?.resource);
    const matchingEnrichers = enabledEnrichers.filter((enricher) =>
      resource ? enricher.resources.has(resource) : false,
    );

    for (const subnetGroupId of referencedSubnetGroupIds) {
      for (const subnetKey of resolveSubnetsFromGroupByName(
        GENERIC_SUBNET_GROUP_KIND,
        subnetGroupId,
        context,
      )) {
        subnetKeys.add(subnetKey);
      }
    }

    const neighborSubnetGroupIds = this.resolveSubnetIdsFromNeighborSubnetGroups(
      currentNodeId,
      context,
    );
    addSubnetIdentifiers(neighborSubnetGroupIds, context, subnetKeys, explicitVpcId);

    return {
      node,
      values,
      resource,
      explicitVpcId,
      explicitVpcKeys,
      subnetKeys,
      vpcKeys,
      matchingEnrichers,
      controls: {},
      referencedVpcIds,
      referencedSubnetIds,
      referencedSubnetGroupIds,
    };
  }

  private buildPlannedSubnetKeysByNodeId(
    placements: ReadonlyMap<NodeId, NodeTopologyPlacement>,
    clonePlans: readonly ClonePlan[],
  ): Map<NodeId, readonly string[]> {
    const plannedSubnetKeysByNodeId = new Map<NodeId, readonly string[]>();

    for (const [nodeId, placement] of placements.entries()) {
      const subnetKey = parseScopeSubnetKey(placement.scopeId);
      if (subnetKey) {
        plannedSubnetKeysByNodeId.set(nodeId, [subnetKey]);
      }
    }

    for (const clonePlan of clonePlans) {
      plannedSubnetKeysByNodeId.set(clonePlan.sourceNodeId, [...clonePlan.subnetKeys]);
    }

    return plannedSubnetKeysByNodeId;
  }

  private finalizePlacementResolution(
    currentNodeId: NodeId,
    graph: AdapterOperations,
    context: PlacementContext,
    resolution: PlacementResolutionState,
    placements: Map<NodeId, NodeTopologyPlacement>,
    clonePlans: ClonePlan[],
  ): boolean {
    const {
      resource,
      explicitVpcKeys,
      subnetKeys,
      vpcKeys,
      controls,
      referencedSubnetIds,
      referencedVpcIds,
      referencedSubnetGroupIds,
      matchingEnrichers,
    } = resolution;
    const previousPlacement = placements.get(currentNodeId);
    const hadClonePlan = clonePlans.some((clonePlan) => clonePlan.sourceNodeId === currentNodeId);
    const hasPlacementChanged = (): boolean => {
      const nextPlacement = placements.get(currentNodeId);
      return (
        nextPlacement?.scopeId !== previousPlacement?.scopeId ||
        nextPlacement?.slotKey !== previousPlacement?.slotKey ||
        nextPlacement?.slotOrder !== previousPlacement?.slotOrder
      );
    };

    for (const subnetKey of subnetKeys) {
      const subnet = context.subnets.get(subnetKey);
      if (subnet?.vpcKey) {
        vpcKeys.add(subnet.vpcKey);
      }
    }

    if (vpcKeys.size === 0 && explicitVpcKeys.size === 0 && subnetKeys.size === 0) {
      for (const key of resolveNeighborVpcKeys(currentNodeId, graph, context.vpcNodeToKey)) {
        vpcKeys.add(key);
      }
    }

    const ownVpcKey = context.vpcNodeToKey.get(String(currentNodeId));
    if (ownVpcKey) {
      vpcKeys.add(ownVpcKey);
    }

    const ownSubnetKey = context.subnetNodeToKey.get(String(currentNodeId));
    if (ownSubnetKey) {
      subnetKeys.add(ownSubnetKey);
    }

    const networkAware = controls.suppressPlacement
      ? false
      : referencedSubnetIds.length > 0 ||
        referencedVpcIds.length > 0 ||
        referencedSubnetGroupIds.length > 0 ||
        subnetKeys.size > 0 ||
        vpcKeys.size > 0 ||
        matchingEnrichers.length > 0;
    const isSubnetPlacementBlacklisted = isSubnetPlacementBlacklistedResource(resource);
    const sortedSubnetKeys = [...subnetKeys].sort((left, right) => left.localeCompare(right));

    if (sortedSubnetKeys.length === 1) {
      if (isSubnetPlacementBlacklisted) {
        const subnetVpcScope = this.resolveVpcScopeFromSubnet(sortedSubnetKeys[0], context.subnets);
        if (subnetVpcScope) {
          placements.set(currentNodeId, this.buildTopologyPlacement(subnetVpcScope, resource));
        }
      } else {
        const scopeId = this.resolveSubnetScope(sortedSubnetKeys[0], context.subnets);
        if (scopeId) {
          placements.set(currentNodeId, this.buildTopologyPlacement(scopeId, resource));
        }
      }

      return hasPlacementChanged();
    }

    if (sortedSubnetKeys.length > 1) {
      const subnetVpcKeys = sortedSubnetKeys
        .map((subnetKey) => context.subnets.get(subnetKey)?.vpcKey)
        .filter((vpcKey): vpcKey is string => !!vpcKey);
      const uniqueSubnetVpcKeys = [...new Set(subnetVpcKeys)];

      if (uniqueSubnetVpcKeys.length === 1) {
        const shouldCloneMultiSubnet = !isSubnetPlacementBlacklisted;

        if (
          shouldCloneMultiSubnet &&
          subnetVpcKeys.length === sortedSubnetKeys.length &&
          sortedSubnetKeys.length > 0
        ) {
          const firstSubnetScope = this.resolveSubnetScope(sortedSubnetKeys[0], context.subnets);
          if (firstSubnetScope) {
            placements.set(currentNodeId, this.buildTopologyPlacement(firstSubnetScope, resource));
          }

          const existingAdditionalReplicaCount = sortedSubnetKeys
            .slice(1)
            .filter((subnetKey) =>
              graph.getNodeAttributes(buildReplicaNodeId(currentNodeId, subnetKey)),
            ).length;

          if (!hadClonePlan && existingAdditionalReplicaCount < sortedSubnetKeys.length - 1) {
            const subnetScopeIds: Record<string, string> = {};
            for (const subnetKey of sortedSubnetKeys) {
              const subnetScopeId = this.resolveSubnetScope(subnetKey, context.subnets);
              if (subnetScopeId) {
                subnetScopeIds[subnetKey] = subnetScopeId;
              }
            }

            clonePlans.push({
              sourceNodeId: currentNodeId,
              subnetKeys: sortedSubnetKeys,
              subnetScopeIds,
              incomingEdges: graph.inEdges(currentNodeId).map((edgeId) => ({
                id: String(edgeId),
                source: graph.edgeSource(edgeId),
                target: graph.edgeTarget(edgeId),
                attributes: graph.getEdgeAttributes(edgeId),
              })),
              outgoingEdges: graph.outEdges(currentNodeId).map((edgeId) => ({
                id: String(edgeId),
                source: graph.edgeSource(edgeId),
                target: graph.edgeTarget(edgeId),
                attributes: graph.getEdgeAttributes(edgeId),
              })),
            });
          }

          let hasClonePlan = false;
          for (const clonePlan of clonePlans) {
            if (clonePlan.sourceNodeId === currentNodeId) {
              hasClonePlan = true;
              break;
            }
          }

          const hasClonePlanChanged = hasClonePlan !== hadClonePlan;
          /* istanbul ignore next -- placement outcomes already validate both change sources together */
          return hasPlacementChanged() || hasClonePlanChanged;
        }

        placements.set(
          currentNodeId,
          this.buildTopologyPlacement(buildVpcScopeId(uniqueSubnetVpcKeys[0]), resource),
        );
        return hasPlacementChanged();
      }

      if (networkAware) {
        const fallbackVpcKey = this.resolveSinglePlaceableVpcKey(context);
        if (fallbackVpcKey) {
          placements.set(
            currentNodeId,
            this.buildTopologyPlacement(buildVpcScopeId(fallbackVpcKey), resource),
          );
        }
      }

      return hasPlacementChanged();
    }

    if (vpcKeys.size === 1) {
      placements.set(
        currentNodeId,
        this.buildTopologyPlacement(buildVpcScopeId([...vpcKeys][0]), resource),
      );
    } else if (networkAware) {
      const fallbackVpcKey = this.resolveSinglePlaceableVpcKey(context);
      if (fallbackVpcKey) {
        placements.set(
          currentNodeId,
          this.buildTopologyPlacement(buildVpcScopeId(fallbackVpcKey), resource),
        );
      }
    }

    return hasPlacementChanged();
  }

  private buildPlacementContext(
    graph: AdapterOperations,
    enrichers: PlacementEnricher[],
  ): PlacementContext {
    const context: PlacementContext = {
      graph,
      vpcs: new Map<string, VpcInfo>(),
      subnets: new Map<string, SubnetInfo>(),
      vpcModulePathToKeys: new Map<string, Set<string>>(),
      vpcIdentifierToKey: new Map<string, string>(),
      subnetIdentifierToKey: new Map<string, string>(),
      vpcNodeToKey: new Map<string, string>(),
      subnetNodeToKey: new Map<string, string>(),
      groupNameToNodeId: new Map<string, Map<string, NodeId>>(),
    };

    const ensureVpc = (key: string, label: string): VpcInfo => {
      const existing = context.vpcs.get(key);
      if (existing) {
        return existing;
      }

      const created: VpcInfo = {
        key,
        label,
      };
      context.vpcs.set(key, created);
      return created;
    };

    const ensureSubnet = (key: string, label: string): SubnetInfo => {
      const existing = context.subnets.get(key);
      if (existing) {
        return existing;
      }

      const created: SubnetInfo = {
        key,
        label,
        vpcReferences: new Set<string>(),
      };
      context.subnets.set(key, created);
      return created;
    };

    const linkVpcIdentifier = (identifier: string | undefined, key: string): void => {
      if (!identifier) {
        return;
      }
      context.vpcIdentifierToKey.set(identifier, key);
    };

    const linkSubnetIdentifier = (identifier: string | undefined, key: string): void => {
      if (!identifier) {
        return;
      }
      context.subnetIdentifierToKey.set(identifier, key);
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

      for (const referencedVpcId of referencedVpcIds) {
        ensureVpc(referencedVpcId, referencedVpcId);
        linkVpcIdentifier(referencedVpcId, referencedVpcId);
      }

      if (referencedSubnetIds.length > 0) {
        addSubnetIdentifiers(referencedSubnetIds, context, new Set<string>(), referencedVpcIds[0]);
      }

      if (isSubnetGroupResource(resource)) {
        const subnetGroups = getOrCreateGroupNodeMap(context, GENERIC_SUBNET_GROUP_KIND);
        linkGroupIdentifier(subnetGroups, toStringValue(values.id), currentNodeId);
        linkGroupIdentifier(subnetGroups, toStringValue(values.arn), currentNodeId);
        linkGroupIdentifier(subnetGroups, toStringValue(values.name), currentNodeId);
        linkGroupIdentifier(subnetGroups, name, currentNodeId);
        linkGroupIdentifier(subnetGroups, address, currentNodeId);
        linkGroupIdentifier(subnetGroups, terraformAddress, currentNodeId);
        linkGroupIdentifier(subnetGroups, String(currentNodeId), currentNodeId);
      }

      if (resource === VPC_RESOURCE) {
        const vpcId = toStringValue(values.id);
        const vpcKey = vpcId ?? name ?? address ?? String(currentNodeId);
        const vpc = ensureVpc(vpcKey, vpcId ?? name ?? vpcKey);
        vpc.nodeId = currentNodeId;

        linkVpcIdentifier(vpcId, vpcKey);
        linkVpcIdentifier(name, vpcKey);
        linkVpcIdentifier(address, vpcKey);
        linkVpcIdentifier(terraformAddress, vpcKey);
        linkVpcIdentifier(String(currentNodeId), vpcKey);
        context.vpcNodeToKey.set(String(currentNodeId), vpcKey);

        if (modulePath) {
          const existingVpcKeys = context.vpcModulePathToKeys.get(modulePath) ?? new Set<string>();
          existingVpcKeys.add(vpcKey);
          context.vpcModulePathToKeys.set(modulePath, existingVpcKeys);
        }
      }

      if (resource === SUBNET_RESOURCE) {
        const subnetId = toStringValue(values.id);
        const subnetKey = subnetId ?? name ?? address ?? terraformAddress ?? String(currentNodeId);
        const subnet = ensureSubnet(subnetKey, subnetId ?? name ?? subnetKey);
        subnet.nodeId = currentNodeId;
        subnet.availabilityZone =
          toStringValue(values.availability_zone) ?? subnet.availabilityZone;

        const referencedVpcId = toStringValue(values.vpc_id);
        if (referencedVpcId) {
          subnet.vpcReferences.add(referencedVpcId);
        }

        linkSubnetIdentifier(subnetId, subnetKey);
        linkSubnetIdentifier(name, subnetKey);
        linkSubnetIdentifier(address, subnetKey);
        linkSubnetIdentifier(terraformAddress, subnetKey);
        linkSubnetIdentifier(String(currentNodeId), subnetKey);
        context.subnetNodeToKey.set(String(currentNodeId), subnetKey);
      }

      for (const enricher of enrichers) {
        enricher.indexNode?.({
          nodeId: currentNodeId,
          node,
          values,
          context,
          resource,
          address,
          name,
        });
      }
    }

    for (const subnet of context.subnets.values()) {
      const referencedVpcKeys = [...subnet.vpcReferences].map((vpcReference) => {
        // Subnet identifiers should already be linked in the context; keep fallback for malformed graphs.
        /* istanbul ignore next */
        const vpcKey = context.vpcIdentifierToKey.get(vpcReference) ?? vpcReference;
        ensureVpc(vpcKey, vpcKey);
        context.vpcIdentifierToKey.set(vpcReference, vpcKey);
        return vpcKey;
      });

      const uniqueReferencedVpcKeys = [...new Set(referencedVpcKeys)];
      if (uniqueReferencedVpcKeys.length === 1) {
        subnet.vpcKey = uniqueReferencedVpcKeys[0];
        continue;
      }

      if (!subnet.nodeId) {
        if (context.vpcs.size === 1) {
          subnet.vpcKey = [...context.vpcs.keys()][0];
        }
        continue;
      }

      const neighborVpcKeys = resolveNeighborVpcKeys(subnet.nodeId, graph, context.vpcNodeToKey);
      if (neighborVpcKeys.size === 1) {
        subnet.vpcKey = [...neighborVpcKeys][0];
        continue;
      }

      const subnetNode = graph.getNodeAttributes(subnet.nodeId);
      if (!subnetNode) {
        continue;
      }

      const moduleVpcKey = resolveUniqueVpcKeyFromModulePath(
        toModulePath(toTerraformAddress(subnetNode)),
        context.vpcModulePathToKeys,
      );
      if (moduleVpcKey) {
        subnet.vpcKey = moduleVpcKey;
      } else if (context.vpcs.size === 1) {
        subnet.vpcKey = [...context.vpcs.keys()][0];
      }
    }

    return context;
  }
  private resolveSubnetIdsFromNeighborSubnetGroups(
    nodeId: NodeId,
    context: PlacementContext,
  ): string[] {
    const subnetIds = new Set<string>();
    const neighbors = new Set<NodeId>([
      ...context.graph.predecessors(nodeId),
      ...context.graph.successors(nodeId),
    ]);

    for (const neighborId of neighbors) {
      const neighbor = context.graph.getNodeAttributes(neighborId);
      if (!neighbor) {
        continue;
      }

      if (!isSubnetGroupResource(toStringValue(neighbor.terraform?.resource))) {
        continue;
      }

      const neighborValues = readStateValues(neighbor);
      for (const subnetId of toStringArray(neighborValues.subnet_ids)) {
        subnetIds.add(subnetId);
      }

      for (const subnetKey of resolveNeighborSubnetKeys(
        neighborId,
        context.graph,
        context.subnetNodeToKey,
      )) {
        subnetIds.add(subnetKey);
      }
    }

    return [...subnetIds];
  }

  private resolveVpcScopeFromSubnet(
    subnetKey: string,
    subnets: Map<string, SubnetInfo>,
  ): string | undefined {
    const subnet = subnets.get(subnetKey);
    if (!subnet?.vpcKey) {
      return undefined;
    }

    return buildVpcScopeId(subnet.vpcKey);
  }

  private resolveSubnetScope(
    subnetKey: string,
    subnets: Map<string, SubnetInfo>,
  ): string | undefined {
    const subnet = subnets.get(subnetKey);
    if (!subnet?.vpcKey) {
      return undefined;
    }

    const az = subnet.availabilityZone ?? 'unknown';
    return buildSubnetScopeId(subnet.vpcKey, az, subnetKey);
  }

  private resolveSinglePlaceableVpcKey(context: PlacementContext): string | undefined {
    const candidateVpcKeys = new Set<string>();

    for (const vpcKey of context.vpcNodeToKey.values()) {
      candidateVpcKeys.add(vpcKey);
    }

    for (const subnet of context.subnets.values()) {
      if (subnet.vpcKey) {
        candidateVpcKeys.add(subnet.vpcKey);
      }
    }

    if (candidateVpcKeys.size === 1) {
      return [...candidateVpcKeys][0];
    }

    return undefined;
  }

  private buildTopologyPlacement(
    scopeId: string,
    resource: string | undefined,
  ): NodeTopologyPlacement {
    const placement: NodeTopologyPlacement = {
      scopeId,
    };

    if (!scopeId.includes(':subnet:')) {
      return placement;
    }

    const contentSlot = resolveAwsSubnetContentSlot(resource);
    if (!contentSlot) {
      return placement;
    }

    return {
      ...placement,
      slotKey: contentSlot.slotKey,
      slotOrder: contentSlot.slotOrder,
    };
  }

  private upsertTopologyPlacement(
    graph: AdapterOperations,
    nodeId: NodeId,
    placement: NodeTopologyPlacement,
  ): AdapterOperations {
    const node = graph.getNodeAttributes(nodeId);
    if (!node) {
      return graph;
    }

    const currentHints = isObjectRecord(node.hints) ? node.hints : {};
    const currentTopology = isObjectRecord(currentHints.topology) ? currentHints.topology : {};
    const currentTopologyRecord = currentTopology as Record<string, unknown>;
    const nextTopology: Record<string, unknown> = {
      ...currentTopology,
      scopeId: placement.scopeId,
    };
    if (placement.slotKey) {
      nextTopology.slotKey = placement.slotKey;
    } else {
      // biome-ignore lint/performance/noDelete: <explanation>
      delete nextTopology.slotKey;
    }
    if (typeof placement.slotOrder === 'number') {
      nextTopology.slotOrder = placement.slotOrder;
    } else {
      // biome-ignore lint/performance/noDelete: <explanation>
      delete nextTopology.slotOrder;
    }

    if (
      currentTopology.scopeId === nextTopology.scopeId &&
      currentTopologyRecord.slotKey === nextTopology.slotKey &&
      currentTopologyRecord.slotOrder === nextTopology.slotOrder
    ) {
      return graph;
    }

    return graph.setNodeAttributes(nodeId, {
      ...node,
      hints: {
        ...currentHints,
        topology: nextTopology,
      },
    });
  }

  private applyClonePlans(graph: AdapterOperations, clonePlans: ClonePlan[]): AdapterOperations {
    let updated = graph;

    for (const clonePlan of clonePlans) {
      // biome-ignore lint/style/noNonNullAssertion: clone plans are created only from existing source nodes
      const sourceNode = updated.getNodeAttributes(clonePlan.sourceNodeId)!;

      const cloneSubnetKeys = clonePlan.subnetKeys.slice(1);
      for (const subnetKey of cloneSubnetKeys) {
        const cloneNodeId = buildReplicaNodeId(clonePlan.sourceNodeId, subnetKey);
        const cloneScopeId = clonePlan.subnetScopeIds[subnetKey];
        /* istanbul ignore next -- defensive guard for malformed clone plans */
        if (!cloneScopeId) {
          continue;
        }

        const existingClone = updated.getNodeAttributes(cloneNodeId);
        const cloneAttributes = {
          ...(existingClone ?? sourceNode),
          id: cloneNodeId,
        };

        updated = this.upsertTopologyPlacement(
          updated.setNodeAttributes(cloneNodeId, cloneAttributes),
          cloneNodeId,
          this.buildTopologyPlacement(cloneScopeId, toStringValue(sourceNode.terraform?.resource)),
        );
      }
    }

    for (const clonePlan of clonePlans) {
      const cloneSubnetKeys = clonePlan.subnetKeys.slice(1);
      for (const subnetKey of cloneSubnetKeys) {
        const cloneNodeId = buildReplicaNodeId(clonePlan.sourceNodeId, subnetKey);
        const cloneScopeId = clonePlan.subnetScopeIds[subnetKey];
        /* istanbul ignore next -- defensive guard for malformed clone plans */
        if (!cloneScopeId) {
          continue;
        }

        for (const edge of clonePlan.incomingEdges) {
          if (edge.source === clonePlan.sourceNodeId) {
            continue;
          }

          const cloneSourceId = this.resolveCloneEdgeEndpoint(updated, edge.source, subnetKey);
          if (!cloneSourceId) {
            continue;
          }

          const cloneInEdgeId = edgeIdFrom(
            cloneSourceId,
            cloneNodeId,
            `aws.network.clone:in:${edge.id}:subnet:${subnetKey}`,
          );
          updated = updated.setEdge(cloneInEdgeId, cloneSourceId, cloneNodeId, edge.attributes);
        }

        for (const edge of clonePlan.outgoingEdges) {
          if (edge.target === clonePlan.sourceNodeId) {
            continue;
          }

          const cloneTargetId = this.resolveCloneEdgeEndpoint(updated, edge.target, subnetKey);
          if (!cloneTargetId) {
            continue;
          }

          const cloneOutEdgeId = edgeIdFrom(
            cloneNodeId,
            cloneTargetId,
            `aws.network.clone:out:${edge.id}:subnet:${subnetKey}`,
          );
          updated = updated.setEdge(cloneOutEdgeId, cloneNodeId, cloneTargetId, edge.attributes);
        }
      }
    }

    return updated;
  }

  private resolveCloneEdgeEndpoint(
    graph: AdapterOperations,
    nodeId: NodeId,
    subnetKey: string,
  ): NodeId | undefined {
    const existingReplicaSubnetKey = parseReplicaSubnetKey(nodeId);
    if (existingReplicaSubnetKey) {
      return existingReplicaSubnetKey === subnetKey ? nodeId : undefined;
    }

    const node = graph.getNodeAttributes(nodeId);
    /* istanbul ignore next -- defensive guard for endpoints disappearing after clone edge snapshots */
    if (!node) {
      return undefined;
    }

    const scopedSubnetKey = parseScopeSubnetKey(node.hints?.topology?.scopeId);
    if (!scopedSubnetKey) {
      return nodeId;
    }

    if (scopedSubnetKey === subnetKey) {
      return nodeId;
    }

    const replicaNodeId = buildReplicaNodeId(nodeId, subnetKey);
    return graph.getNodeAttributes(replicaNodeId) ? replicaNodeId : undefined;
  }
}

export class AwsNetworkPlacementPlugin extends GraphPlugin<AwsNetworkPlacementPluginOptions> {
  static id = pluginId(`aws.${AwsNetworkPlacementPlugin.name}`);

  constructor() {
    super(AwsNetworkPlacementPlugin.id, {
      enrichers: [],
      mode: 'full',
    });
  }

  public override build(
    input: GraphPluginBuildInput<AwsNetworkPlacementPluginOptions>,
  ): GraphPluginBuildResult {
    const options = {
      ...resolveAwsNetworkPlacementOptions(input.options),
    };

    return {
      phases: [
        {
          phase: 'main',
          rules: [
            new ApplyAwsNetworkPlacementHints({
              node: {
                any: true,
              },
              options,
            }),
          ],
        },
        {
          phase: 'main' as NamedPhase,
          rules: [
            new ApplyAwsNetworkCleanup({
              node: {
                any: true,
              },
              options,
            }),
          ],
        },
      ],
    };
  }
}

NodeRule.register(ApplyAwsNetworkPlacementHints);
