import { DefaultEdgeDirectionSemantics } from '@terra-graph/core';

export const AwsEdgeDirectionSemantics = {
  ...DefaultEdgeDirectionSemantics,
} as const;

export type AwsEdgeDirectionSemantic =
  (typeof AwsEdgeDirectionSemantics)[keyof typeof AwsEdgeDirectionSemantics];
