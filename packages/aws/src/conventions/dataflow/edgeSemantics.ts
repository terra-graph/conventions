import { DefaultEdgeSemantics } from '@terra-graph/core';

export const AwsEdgeSemantics = {
  ...DefaultEdgeSemantics,
} as const;

export type AwsEdgeSemantic = (typeof AwsEdgeSemantics)[keyof typeof AwsEdgeSemantics];
