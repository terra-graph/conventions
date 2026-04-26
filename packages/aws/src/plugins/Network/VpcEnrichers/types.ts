import type { AdapterOperations, NodeId, TgNodeAttributes } from '@terra-graph/core';

export type AwsNetworkPlacementEnricherId =
  | 'rds'
  | 'elasticache'
  | 'ecs'
  | 'ec2'
  | 'network';
export type AwsNetworkVisibilityMode = 'full' | 'architecture' | 'minimal';

export type AwsNetworkPlacementPluginOptions = {
  enrichers?: AwsNetworkPlacementEnricherId[];
  mode?: AwsNetworkVisibilityMode;
};

export type VpcInfo = {
  key: string;
  label: string;
  nodeId?: NodeId;
};

export type SubnetInfo = {
  key: string;
  label: string;
  nodeId?: NodeId;
  availabilityZone?: string;
  vpcReferences: Set<string>;
  vpcKey?: string;
};

export type PlacementContext = {
  graph: AdapterOperations;
  vpcs: Map<string, VpcInfo>;
  subnets: Map<string, SubnetInfo>;
  vpcModulePathToKeys: Map<string, Set<string>>;
  vpcIdentifierToKey: Map<string, string>;
  subnetIdentifierToKey: Map<string, string>;
  vpcNodeToKey: Map<string, string>;
  subnetNodeToKey: Map<string, string>;
  groupNameToNodeId: Map<string, Map<string, NodeId>>;
};

export type EnricherIndexInput = {
  nodeId: NodeId;
  node: TgNodeAttributes;
  values: Record<string, unknown>;
  context: PlacementContext;
  resource?: string;
  address?: string;
  name?: string;
};

export type EnricherApplyInput = {
  nodeId: NodeId;
  node: TgNodeAttributes;
  values: Record<string, unknown>;
  context: PlacementContext;
  subnetKeys: Set<string>;
  vpcKeys: Set<string>;
  explicitVpcId?: string;
};

export type PlacementEnricher = {
  id: AwsNetworkPlacementEnricherId;
  resources: ReadonlySet<string>;
  indexNode?: (input: EnricherIndexInput) => void;
  apply: (input: EnricherApplyInput) => void;
};
