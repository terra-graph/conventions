import { DefaultEdgeSemanticRoles, DefaultEdgeSemantics } from '@terra-graph/core';

export const AwsEdgeSemantics = {
  ...DefaultEdgeSemantics,
  DeadLettersTo: {
    semantic: 'dead_letters_to',
    role: DefaultEdgeSemanticRoles.Primary,
  },
} as const;

export type AwsEdgeSemantic = (typeof AwsEdgeSemantics)[keyof typeof AwsEdgeSemantics];
