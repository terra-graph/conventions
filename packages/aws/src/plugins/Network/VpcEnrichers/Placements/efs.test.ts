import { type AdapterOperations, type TgNodeAttributes, asNodeId } from '@terra-graph/core';
import type { PlacementContext } from '../types.js';
import { EfsPlacementEnricher } from './efs.js';

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

describe('EfsPlacementEnricher', () => {
  it('shoud place file systems mount targets and access points from mount target subnets', () => {
    const fileSystemId = asNodeId('resource.aws_efs_file_system.shared');
    const mountTargetAId = asNodeId('resource.aws_efs_mount_target.a');
    const mountTargetBId = asNodeId('resource.aws_efs_mount_target.b');
    const mountTargetNoSubnetId = asNodeId('resource.aws_efs_mount_target.no_subnet');
    const accessPointId = asNodeId('resource.aws_efs_access_point.app');
    const missingNeighbor = asNodeId('resource.missing.neighbor');
    const nonMountTargetNeighbor = asNodeId('resource.aws_security_group.ignore');

    const graph = {
      getNodeAttributes: (nodeId: string) => {
        if (nodeId === fileSystemId) {
          return {
            terraform: {
              resource: 'aws_efs_file_system',
              state: {
                effective: {
                  values: {
                    id: 'fs-1',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === mountTargetAId) {
          return {
            terraform: {
              resource: 'aws_efs_mount_target',
              state: {
                effective: {
                  values: {
                    file_system_id: 'fs-1',
                    subnet_id: 'subnet-a',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === mountTargetBId) {
          return {
            terraform: {
              resource: 'aws_efs_mount_target',
              state: {
                effective: {
                  values: {
                    file_system_id: 'fs-1',
                    subnet_id: 'subnet-b',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        if (nodeId === accessPointId) {
          return {
            terraform: {
              resource: 'aws_efs_access_point',
            },
          } as TgNodeAttributes;
        }

        if (nodeId === nonMountTargetNeighbor) {
          return {
            terraform: {
              resource: 'aws_security_group',
            },
          } as TgNodeAttributes;
        }

        if (nodeId === mountTargetNoSubnetId) {
          return {
            terraform: {
              resource: 'aws_efs_mount_target',
              state: {
                effective: {
                  values: {
                    file_system_id: 'fs-1',
                  },
                },
              },
            },
          } as TgNodeAttributes;
        }

        return undefined;
      },
      predecessors: (nodeId: string) => {
        if (nodeId === fileSystemId) {
          return [
            mountTargetAId,
            mountTargetBId,
            mountTargetNoSubnetId,
            nonMountTargetNeighbor,
            missingNeighbor,
          ];
        }

        return [];
      },
      successors: () => [],
      nodeIds: () => [
        fileSystemId,
        mountTargetAId,
        mountTargetBId,
        mountTargetNoSubnetId,
        accessPointId,
      ],
    } as unknown as AdapterOperations;

    const context = buildContext(graph);

    EfsPlacementEnricher.indexNode?.({
      nodeId: fileSystemId,
      node: {
        terraform: {
          address: 'aws_efs_file_system.shared',
        },
      } as TgNodeAttributes,
      values: {
        id: 'fs-1',
      },
      context,
      resource: 'aws_efs_file_system',
      address: 'aws_efs_file_system.shared',
      name: 'shared',
    });

    EfsPlacementEnricher.indexNode?.({
      nodeId: accessPointId,
      node: {} as TgNodeAttributes,
      values: {},
      context,
      resource: 'aws_efs_access_point',
      address: undefined,
      name: undefined,
    });

    const mountSubnetKeys = new Set<string>();
    EfsPlacementEnricher.apply({
      nodeId: mountTargetAId,
      node: {
        terraform: {
          resource: 'aws_efs_mount_target',
        },
      } as TgNodeAttributes,
      values: {
        subnet_id: 'subnet-a',
      },
      context,
      subnetKeys: mountSubnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: {},
    });

    expect(mountSubnetKeys).toStrictEqual(new Set<string>(['subnet-a']));

    const mountNoSubnetKeys = new Set<string>();
    EfsPlacementEnricher.apply({
      nodeId: mountTargetNoSubnetId,
      node: {
        terraform: {
          resource: 'aws_efs_mount_target',
        },
      } as TgNodeAttributes,
      values: {},
      context,
      subnetKeys: mountNoSubnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: {},
    });

    expect(mountNoSubnetKeys.size).toBe(0);

    const fileSystemSubnetKeys = new Set<string>();
    EfsPlacementEnricher.apply({
      nodeId: fileSystemId,
      node: {
        terraform: {
          resource: 'aws_efs_file_system',
        },
      } as TgNodeAttributes,
      values: {
        id: 'fs-1',
      },
      context,
      subnetKeys: fileSystemSubnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: {},
    });

    expect(fileSystemSubnetKeys).toStrictEqual(new Set<string>(['subnet-a', 'subnet-b']));

    const accessPointSubnetKeys = new Set<string>();
    EfsPlacementEnricher.apply({
      nodeId: accessPointId,
      node: {
        terraform: {
          resource: 'aws_efs_access_point',
        },
      } as TgNodeAttributes,
      values: {
        file_system_id: 'fs-1',
      },
      context,
      subnetKeys: accessPointSubnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: {},
    });

    expect(accessPointSubnetKeys).toStrictEqual(new Set<string>(['subnet-a', 'subnet-b']));

    const unresolvedSubnetKeys = new Set<string>();
    EfsPlacementEnricher.apply({
      nodeId: accessPointId,
      node: {
        terraform: {
          resource: 'aws_efs_access_point',
        },
      } as TgNodeAttributes,
      values: {
        file_system_id: 'missing-fs',
      },
      context,
      subnetKeys: unresolvedSubnetKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: {},
    });

    expect(unresolvedSubnetKeys.size).toBe(0);

    const missingFsIdKeys = new Set<string>();
    EfsPlacementEnricher.apply({
      nodeId: accessPointId,
      node: {
        terraform: {
          resource: 'aws_efs_access_point',
        },
      } as TgNodeAttributes,
      values: {},
      context,
      subnetKeys: missingFsIdKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: {},
    });

    expect(missingFsIdKeys.size).toBe(0);

    const ignoredResourceKeys = new Set<string>();
    EfsPlacementEnricher.apply({
      nodeId: asNodeId('resource.aws_iam_role.ignore'),
      node: {
        terraform: {
          resource: 'aws_iam_role',
        },
      } as TgNodeAttributes,
      values: {},
      context,
      subnetKeys: ignoredResourceKeys,
      vpcKeys: new Set<string>(),
      explicitVpcId: undefined,
      controls: {},
    });

    expect(ignoredResourceKeys.size).toBe(0);
  });
});
