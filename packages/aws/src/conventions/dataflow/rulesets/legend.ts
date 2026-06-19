import { EdgeSemanticLegend, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const legendSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemanticLegend({
      edge: {
        from: { any: true },
        to: { any: true },
      },
      options: {
        legendBySemantic: {
          [AwsEdgeSemantics.Invokes.semantic]: {
            title: 'Invokes',
            colour: '#0d6efd',
          },
          [AwsEdgeSemantics.Accesses.semantic]: {
            title: 'Accesses data',
            colour: '#198754',
          },
          [AwsEdgeSemantics.Reads.semantic]: {
            title: 'Reads data',
            colour: '#198754',
          },
          [AwsEdgeSemantics.Writes.semantic]: {
            title: 'Writes data',
            colour: '#20a39e',
          },
          [AwsEdgeSemantics.Publishes.semantic]: {
            title: 'Publishes event',
            colour: '#fd7e14',
          },
          [AwsEdgeSemantics.Triggers.semantic]: {
            title: 'Triggers async consumer',
            colour: '#dc3545',
          },
          [AwsEdgeSemantics.Routes.semantic]: {
            title: 'Routes request',
            colour: '#6f42c1',
          },
          [AwsEdgeSemantics.Authorizes.semantic]: {
            title: 'Authorizes',
            colour: '#8dd7c5',
          },
          [AwsEdgeSemantics.ObservedBy.semantic]: {
            title: 'Observed by telemetry',
            colour: '#20c997',
          },
          [AwsEdgeSemantics.DeadLettersTo.semantic]: {
            title: 'Dead-letters to',
            colour: '#6c757d',
          },
        },
      },
    }),
  ],
});

export default legendSemanticsRuleSet;
