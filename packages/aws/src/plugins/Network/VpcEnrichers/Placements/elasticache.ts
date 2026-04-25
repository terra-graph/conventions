import {
  addSubnetIdentifiers,
  getOrCreateGroupNodeMap,
  linkGroupIdentifier,
  resolveSubnetIdsFromGroupNeighbors,
  resolveSubnetsFromGroupByName,
  toStringValue,
} from '../shared.js';
import type { PlacementEnricher } from '../types.js';

const GROUP_KIND = 'elasticache';
const ELASTICACHE_REPLICATION_GROUP_RESOURCE = 'aws_elasticache_replication_group';
const ELASTICACHE_CLUSTER_RESOURCE = 'aws_elasticache_cluster';
const ELASTICACHE_SUBNET_GROUP_RESOURCE = 'aws_elasticache_subnet_group';

export const ElasticachePlacementEnricher: PlacementEnricher = {
  id: 'elasticache',
  resources: new Set<string>([
    ELASTICACHE_REPLICATION_GROUP_RESOURCE,
    ELASTICACHE_CLUSTER_RESOURCE,
  ]),
  indexNode: ({ nodeId, values, context, resource, name, address }) => {
    if (resource !== ELASTICACHE_SUBNET_GROUP_RESOURCE) {
      return;
    }

    const cacheGroups = getOrCreateGroupNodeMap(context, GROUP_KIND);
    const stateName = toStringValue(values.name);
    linkGroupIdentifier(cacheGroups, stateName, nodeId);
    linkGroupIdentifier(cacheGroups, name, nodeId);
    linkGroupIdentifier(cacheGroups, address, nodeId);
    linkGroupIdentifier(cacheGroups, String(nodeId), nodeId);
  },
  apply: ({ nodeId, values, context, subnetKeys, explicitVpcId }) => {
    const subnetGroupName = toStringValue(values.subnet_group_name);
    for (const subnetKey of resolveSubnetsFromGroupByName(GROUP_KIND, subnetGroupName, context)) {
      subnetKeys.add(subnetKey);
    }

    addSubnetIdentifiers(
      resolveSubnetIdsFromGroupNeighbors(ELASTICACHE_SUBNET_GROUP_RESOURCE, nodeId, context),
      context,
      subnetKeys,
      explicitVpcId,
    );
  },
};
