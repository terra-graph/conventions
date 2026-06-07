import {
  type AdapterOperations,
  type NodeId,
  NodeRule,
  type TgEdgeAttributes,
  type TgNodeAttributes,
  edgeIdFrom,
  isObjectRecord,
} from '@terra-graph/core';

type ParsedTerraformInstanceAddress = {
  baseAddress: string;
  key?: string;
  ordinal?: number;
};

type ResourceInstance = {
  nodeId: NodeId;
  address: string;
  key?: string;
  ordinal?: number;
  isSingleton: boolean;
};

type ResourceGroup = {
  baseAddress: string;
  familyNodeId?: NodeId;
  instances: ResourceInstance[];
};

type EdgeReference = {
  edgeId: string;
  peerNodeId: NodeId;
  attributes: TgEdgeAttributes;
};

type MaterializedEdge = {
  attributes: TgEdgeAttributes;
  from: NodeId;
  sourceEdgeId: string;
  to: NodeId;
};

const parseTerraformInstanceAddress = (address: string): ParsedTerraformInstanceAddress => {
  const match = address.match(/^(.*)\[(.+)\]$/);
  if (!match) {
    return {
      baseAddress: address,
    };
  }

  const [, baseAddress, rawIndex] = match;
  const indexValue = rawIndex.trim();
  if (/^-?\d+$/.test(indexValue)) {
    return {
      baseAddress,
      key: indexValue,
      ordinal: Number(indexValue),
    };
  }

  if (indexValue.startsWith('"') && indexValue.endsWith('"')) {
    try {
      return {
        baseAddress,
        key: JSON.parse(indexValue) as string,
      };
    } catch {
      // Fall back to the raw segment below.
    }
  }

  return {
    baseAddress,
    key: indexValue,
  };
};

const isResourceNode = (
  node: TgNodeAttributes | undefined,
): node is TgNodeAttributes & {
  terraform: NonNullable<TgNodeAttributes['terraform']>;
} => node?.terraform?.kind === 'resource';

const hasFullKeyCoverage = (instances: ResourceInstance[]): boolean =>
  instances.every((instance) => instance.key !== undefined);

const keysEqual = (source: ResourceInstance[], target: ResourceInstance[]): boolean => {
  const sourceKeys = source.map((instance) => instance.key).sort();
  const targetKeys = target.map((instance) => instance.key).sort();
  return JSON.stringify(sourceKeys) === JSON.stringify(targetKeys);
};

const hasFullOrdinalCoverage = (instances: ResourceInstance[]): boolean =>
  instances.every((instance) => instance.ordinal !== undefined);

const groupBy = <T>(values: T[], toKey: (value: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const key = toKey(value);
    const current = grouped.get(key) ?? [];
    current.push(value);
    grouped.set(key, current);
  }
  return grouped;
};

export class MaterializeCardinalityResources extends NodeRule {
  public override apply(
    nodeId: NodeId,
    _node: TgNodeAttributes,
    graph: AdapterOperations,
  ): AdapterOperations {
    if (!this.wasMatched(nodeId)) {
      return graph;
    }

    const firstNodeId = graph.nodeIds()[0];
    if (!firstNodeId || firstNodeId !== nodeId) {
      return graph;
    }

    const groups = this.resourceGroups(graph);
    const candidates = [...groups.values()].filter(
      (group) => group.familyNodeId !== undefined && group.instances.length > 0,
    );
    if (candidates.length === 0) {
      return graph;
    }

    const removableFamilies = new Set<NodeId>();
    const plannedEdges = new Map<
      ReturnType<typeof edgeIdFrom>,
      { from: NodeId; to: NodeId; attributes: TgEdgeAttributes }
    >();

    for (const group of candidates) {
      const familyNodeId = group.familyNodeId;
      if (!familyNodeId) {
        continue;
      }

      const planned = this.planFamilyMaterialization(group, groups, graph);
      if (!planned) {
        continue;
      }

      removableFamilies.add(familyNodeId);
      for (const edge of planned) {
        const edgeId = edgeIdFrom(
          edge.from,
          edge.to,
          `materialize_cardinality:${edge.sourceEdgeId}`,
        );
        plannedEdges.set(edgeId, {
          from: edge.from,
          to: edge.to,
          attributes: edge.attributes,
        });
      }
    }

    if (removableFamilies.size === 0) {
      return graph;
    }

    let updated = graph;
    for (const [edgeId, edge] of plannedEdges.entries()) {
      updated = updated.setEdge(edgeId, edge.from, edge.to, edge.attributes);
    }
    for (const familyNodeId of removableFamilies) {
      updated = updated.removeNode(familyNodeId);
    }

    return updated;
  }

  private planFamilyMaterialization(
    group: ResourceGroup,
    groups: Map<string, ResourceGroup>,
    graph: AdapterOperations,
  ): MaterializedEdge[] | undefined {
    const familyNodeId = group.familyNodeId;
    if (!familyNodeId) {
      return undefined;
    }

    const membershipNodeIds = new Set(group.instances.map((instance) => instance.nodeId));
    const inbound = graph
      .inEdges(familyNodeId)
      .filter((edgeId) => {
        const sourceId = graph.edgeSource(edgeId);
        return sourceId !== familyNodeId && !membershipNodeIds.has(sourceId);
      })
      .map((edgeId) => ({
        edgeId,
        peerNodeId: graph.edgeSource(edgeId),
        attributes: graph.getEdgeAttributes(edgeId),
      }));
    const outbound = graph
      .outEdges(familyNodeId)
      .filter((edgeId) => {
        const targetId = graph.edgeTarget(edgeId);
        return targetId !== familyNodeId && !membershipNodeIds.has(targetId);
      })
      .map((edgeId) => ({
        edgeId,
        peerNodeId: graph.edgeTarget(edgeId),
        attributes: graph.getEdgeAttributes(edgeId),
      }));

    const plannedEdges: MaterializedEdge[] = [];
    for (const entry of groupBy(inbound, (ref) =>
      this.externalGroupKey(ref.peerNodeId, groups, graph),
    ).values()) {
      const peerInstances = this.resolveExternalInstances(entry, groups, graph);
      const pairs = this.matchInstances(peerInstances, group.instances);
      if (!pairs) {
        return undefined;
      }

      for (const pair of pairs) {
        const edgeRef = entry.find((ref) => ref.peerNodeId === pair.from) ?? entry[0];
        if (!edgeRef) {
          return undefined;
        }

        plannedEdges.push({
          attributes: edgeRef.attributes,
          from: pair.from,
          sourceEdgeId: edgeRef.edgeId,
          to: pair.to,
        });
      }
    }

    for (const entry of groupBy(outbound, (ref) =>
      this.externalGroupKey(ref.peerNodeId, groups, graph),
    ).values()) {
      const peerInstances = this.resolveExternalInstances(entry, groups, graph);
      const pairs = this.matchInstances(group.instances, peerInstances);
      if (!pairs) {
        return undefined;
      }

      for (const pair of pairs) {
        const edgeRef = entry.find((ref) => ref.peerNodeId === pair.to) ?? entry[0];
        if (!edgeRef) {
          return undefined;
        }

        plannedEdges.push({
          attributes: edgeRef.attributes,
          from: pair.from,
          sourceEdgeId: edgeRef.edgeId,
          to: pair.to,
        });
      }
    }

    return plannedEdges;
  }

  private resourceGroups(graph: AdapterOperations): Map<string, ResourceGroup> {
    const groups = new Map<string, ResourceGroup>();

    for (const nodeId of graph.nodeIds()) {
      const node = graph.getNodeAttributes(nodeId);
      if (!isResourceNode(node)) {
        continue;
      }

      const address = node.terraform.address;
      if (!address) {
        continue;
      }

      const parsed = parseTerraformInstanceAddress(address);
      const current = groups.get(parsed.baseAddress) ?? {
        baseAddress: parsed.baseAddress,
        instances: [],
      };

      if (parsed.baseAddress === address) {
        current.familyNodeId = nodeId;
        groups.set(parsed.baseAddress, current);
        continue;
      }

      const ordinal = parsed.ordinal ?? this.stateOrdinal(node, address) ?? undefined;
      current.instances.push({
        nodeId,
        address,
        key: parsed.key,
        ordinal,
        isSingleton: false,
      });
      groups.set(parsed.baseAddress, current);
    }

    for (const group of groups.values()) {
      group.instances.sort((left, right) => {
        if (left.ordinal !== undefined && right.ordinal !== undefined) {
          return left.ordinal - right.ordinal;
        }

        return left.address.localeCompare(right.address);
      });
    }

    return groups;
  }

  private externalGroupKey(
    nodeId: NodeId,
    groups: Map<string, ResourceGroup>,
    graph: AdapterOperations,
  ): string {
    const node = graph.getNodeAttributes(nodeId);
    if (!isResourceNode(node)) {
      return `node:${String(nodeId)}`;
    }

    const address = node.terraform.address;
    if (!address) {
      return `node:${String(nodeId)}`;
    }

    const parsed = parseTerraformInstanceAddress(address);
    const group = groups.get(parsed.baseAddress);
    if (group?.instances.length) {
      return `resource:${parsed.baseAddress}`;
    }

    return `node:${String(nodeId)}`;
  }

  private resolveExternalInstances(
    references: EdgeReference[],
    groups: Map<string, ResourceGroup>,
    graph: AdapterOperations,
  ): ResourceInstance[] {
    const explicitInstances: ResourceInstance[] = [];

    for (const reference of references) {
      const node = graph.getNodeAttributes(reference.peerNodeId);
      if (!isResourceNode(node)) {
        continue;
      }

      const address = node.terraform.address;
      if (!address) {
        continue;
      }

      const parsed = parseTerraformInstanceAddress(address);
      if (parsed.baseAddress !== address) {
        explicitInstances.push({
          nodeId: reference.peerNodeId,
          address,
          key: parsed.key,
          ordinal: parsed.ordinal ?? this.stateOrdinal(node, address) ?? undefined,
          isSingleton: false,
        });
      }
    }

    if (explicitInstances.length > 0) {
      return explicitInstances.sort((left, right) => {
        if (left.ordinal !== undefined && right.ordinal !== undefined) {
          return left.ordinal - right.ordinal;
        }

        return left.address.localeCompare(right.address);
      });
    }

    const firstReference = references[0];
    if (!firstReference) {
      return [];
    }

    const node = graph.getNodeAttributes(firstReference.peerNodeId);
    if (!isResourceNode(node)) {
      return [
        {
          nodeId: firstReference.peerNodeId,
          address: String(firstReference.peerNodeId),
          isSingleton: true,
        },
      ];
    }

    const address = node.terraform.address;
    if (!address) {
      return [
        {
          nodeId: firstReference.peerNodeId,
          address: String(firstReference.peerNodeId),
          isSingleton: true,
        },
      ];
    }

    const parsed = parseTerraformInstanceAddress(address);
    const group = groups.get(parsed.baseAddress);
    if (group?.instances.length) {
      return group.instances;
    }

    return [
      {
        nodeId: firstReference.peerNodeId,
        address,
        isSingleton: true,
      },
    ];
  }

  private matchInstances(
    sourceInstances: ResourceInstance[],
    targetInstances: ResourceInstance[],
  ): Array<{ from: NodeId; to: NodeId }> | undefined {
    if (sourceInstances.length === 0 || targetInstances.length === 0) {
      return undefined;
    }

    if (sourceInstances.some((instance) => instance.isSingleton)) {
      return sourceInstances.flatMap((source) =>
        targetInstances.map((target) => ({
          from: source.nodeId,
          to: target.nodeId,
        })),
      );
    }

    if (targetInstances.some((instance) => instance.isSingleton)) {
      return sourceInstances.flatMap((source) =>
        targetInstances.map((target) => ({
          from: source.nodeId,
          to: target.nodeId,
        })),
      );
    }

    if (
      sourceInstances.length === targetInstances.length &&
      hasFullKeyCoverage(sourceInstances) &&
      hasFullKeyCoverage(targetInstances) &&
      keysEqual(sourceInstances, targetInstances)
    ) {
      const targetByKey = new Map(
        targetInstances.map((instance) => [instance.key as string, instance]),
      );
      return sourceInstances.map((source) => ({
        from: source.nodeId,
        to: (targetByKey.get(source.key as string) as ResourceInstance).nodeId,
      }));
    }

    const keyIntersection = sourceInstances.filter((source) =>
      targetInstances.some((target) => target.key === source.key),
    );
    if (keyIntersection.length > 0) {
      return undefined;
    }

    if (
      sourceInstances.length === targetInstances.length &&
      hasFullOrdinalCoverage(sourceInstances) &&
      hasFullOrdinalCoverage(targetInstances)
    ) {
      const sortedSource = [...sourceInstances].sort(
        (left, right) => (left.ordinal as number) - (right.ordinal as number),
      );
      const sortedTarget = [...targetInstances].sort(
        (left, right) => (left.ordinal as number) - (right.ordinal as number),
      );
      return sortedSource.map((source, index) => ({
        from: source.nodeId,
        to: sortedTarget[index]?.nodeId as NodeId,
      }));
    }

    return undefined;
  }

  private stateOrdinal(node: TgNodeAttributes, address: string): number | undefined {
    const instances = node.terraform?.state?.instances;
    if (!instances) {
      return undefined;
    }

    const explicitIndex = instances.findIndex((instance) => instance.address === address);
    return explicitIndex >= 0 ? explicitIndex : undefined;
  }
}

NodeRule.register(MaterializeCardinalityResources);
