import type { NodeId } from '@terra-graph/core';
import {
  addSubnetIdentifiers,
  getOrCreateGroupNodeMap,
  linkGroupIdentifier,
  readStateValues,
  toStringValue,
} from '../shared.js';
import type { PlacementContext, PlacementEnricher } from '../types.js';

const FILE_SYSTEM_RESOURCE = 'aws_efs_file_system';
const MOUNT_TARGET_RESOURCE = 'aws_efs_mount_target';
const ACCESS_POINT_RESOURCE = 'aws_efs_access_point';

const GROUP_KIND_FILE_SYSTEM = 'efs.file_system';

const addMountTargetSubnet = (
  nodeId: NodeId,
  context: PlacementContext,
  subnetKeys: Set<string>,
  explicitVpcId?: string,
): void => {
  const node = context.graph.getNodeAttributes(nodeId);
  if (!node) {
    return;
  }

  if (toStringValue(node.terraform?.resource) !== MOUNT_TARGET_RESOURCE) {
    return;
  }

  const mountTargetValues = readStateValues(node);
  const subnetId = toStringValue(mountTargetValues.subnet_id);
  if (!subnetId) {
    return;
  }

  addSubnetIdentifiers([subnetId], context, subnetKeys, explicitVpcId);
};

const addMountTargetSubnetsByNeighbors = (
  nodeId: NodeId,
  context: PlacementContext,
  subnetKeys: Set<string>,
  explicitVpcId?: string,
): void => {
  const neighbors = new Set<NodeId>([
    ...context.graph.predecessors(nodeId),
    ...context.graph.successors(nodeId),
  ]);

  for (const neighborId of neighbors) {
    addMountTargetSubnet(neighborId, context, subnetKeys, explicitVpcId);
  }
};

const addMountTargetSubnetsByFileSystemId = (
  fileSystemId: string,
  context: PlacementContext,
  subnetKeys: Set<string>,
  explicitVpcId?: string,
): void => {
  for (const currentNodeId of context.graph.nodeIds()) {
    const node = context.graph.getNodeAttributes(currentNodeId);
    if (!node || toStringValue(node.terraform?.resource) !== MOUNT_TARGET_RESOURCE) {
      continue;
    }

    const values = readStateValues(node);
    if (toStringValue(values.file_system_id) !== fileSystemId) {
      continue;
    }

    const subnetId = toStringValue(values.subnet_id);
    if (!subnetId) {
      continue;
    }

    addSubnetIdentifiers([subnetId], context, subnetKeys, explicitVpcId);
  }
};

export const EfsPlacementEnricher: PlacementEnricher = {
  id: 'efs',
  resources: new Set<string>([FILE_SYSTEM_RESOURCE, MOUNT_TARGET_RESOURCE, ACCESS_POINT_RESOURCE]),
  indexNode: ({ nodeId, node, values, context, resource, address, name }) => {
    if (resource !== FILE_SYSTEM_RESOURCE) {
      return;
    }

    const fileSystems = getOrCreateGroupNodeMap(context, GROUP_KIND_FILE_SYSTEM);
    linkGroupIdentifier(fileSystems, toStringValue(values.id), nodeId);
    linkGroupIdentifier(fileSystems, toStringValue(values.arn), nodeId);
    linkGroupIdentifier(fileSystems, toStringValue(values.name), nodeId);
    linkGroupIdentifier(fileSystems, name, nodeId);
    linkGroupIdentifier(fileSystems, address, nodeId);
    linkGroupIdentifier(fileSystems, toStringValue(node.terraform?.address), nodeId);
    linkGroupIdentifier(fileSystems, String(nodeId), nodeId);
  },
  apply: ({ nodeId, node, values, context, subnetKeys, explicitVpcId }) => {
    const resource = toStringValue(node.terraform?.resource);

    if (resource === MOUNT_TARGET_RESOURCE) {
      const subnetId = toStringValue(values.subnet_id);
      if (!subnetId) {
        return;
      }

      addSubnetIdentifiers([subnetId], context, subnetKeys, explicitVpcId);
      return;
    }

    if (resource === FILE_SYSTEM_RESOURCE) {
      addMountTargetSubnetsByNeighbors(nodeId, context, subnetKeys, explicitVpcId);
      const fileSystemId = toStringValue(values.id);
      if (fileSystemId) {
        addMountTargetSubnetsByFileSystemId(fileSystemId, context, subnetKeys, explicitVpcId);
      }
      return;
    }

    if (resource !== ACCESS_POINT_RESOURCE) {
      return;
    }

    const fileSystemId = toStringValue(values.file_system_id);
    if (!fileSystemId) {
      return;
    }

    const fileSystemNodeId = context.groupNameToNodeId
      .get(GROUP_KIND_FILE_SYSTEM)
      ?.get(fileSystemId);
    if (fileSystemNodeId) {
      addMountTargetSubnetsByNeighbors(fileSystemNodeId, context, subnetKeys, explicitVpcId);
    }

    addMountTargetSubnetsByFileSystemId(fileSystemId, context, subnetKeys, explicitVpcId);
  },
};
