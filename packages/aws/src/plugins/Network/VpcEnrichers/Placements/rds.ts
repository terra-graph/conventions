import {
  addSubnetIdentifiers,
  getOrCreateGroupNodeMap,
  linkGroupIdentifier,
  resolveSubnetIdsFromGroupNeighbors,
  resolveSubnetsFromGroupByName,
  toStringValue,
} from '../shared.js';
import type { PlacementEnricher } from '../types.js';

const GROUP_KIND = 'rds';
const DB_INSTANCE_RESOURCE = 'aws_db_instance';
const DB_SUBNET_GROUP_RESOURCE = 'aws_db_subnet_group';

export const RdsPlacementEnricher: PlacementEnricher = {
  id: 'rds',
  resources: new Set<string>([DB_INSTANCE_RESOURCE, DB_SUBNET_GROUP_RESOURCE]),
  indexNode: ({ nodeId, values, context, resource, name, address }) => {
    if (resource !== DB_SUBNET_GROUP_RESOURCE) {
      return;
    }

    const dbGroups = getOrCreateGroupNodeMap(context, GROUP_KIND);
    const stateName = toStringValue(values.name);
    linkGroupIdentifier(dbGroups, stateName, nodeId);
    linkGroupIdentifier(dbGroups, name, nodeId);
    linkGroupIdentifier(dbGroups, address, nodeId);
    linkGroupIdentifier(dbGroups, String(nodeId), nodeId);
  },
  apply: ({ nodeId, values, context, subnetKeys, explicitVpcId }) => {
    const subnetGroupName = toStringValue(values.db_subnet_group_name);
    for (const subnetKey of resolveSubnetsFromGroupByName(GROUP_KIND, subnetGroupName, context)) {
      subnetKeys.add(subnetKey);
    }

    addSubnetIdentifiers(
      resolveSubnetIdsFromGroupNeighbors(DB_SUBNET_GROUP_RESOURCE, nodeId, context),
      context,
      subnetKeys,
      explicitVpcId,
    );
  },
};
