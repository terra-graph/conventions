import { EdgeSemanticLegend, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const legendSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemanticLegend({
      edge: {
        from: { any: true },
        to: { any: true },
      },
      options: {
        legendBySemantic: {
          [AwsEdgeDirectionSemantics.Invokes]: {
            title: 'Invokes',
            colour: '#0d6efd',
          },
          [AwsEdgeDirectionSemantics.Accesses]: {
            title: 'Accesses data',
            colour: '#198754',
          },
          [AwsEdgeDirectionSemantics.Publishes]: {
            title: 'Publishes event',
            colour: '#fd7e14',
          },
          [AwsEdgeDirectionSemantics.Triggers]: {
            title: 'Triggers async consumer',
            colour: '#dc3545',
          },
          [AwsEdgeDirectionSemantics.Routes]: {
            title: 'Routes request',
            colour: '#6f42c1',
          },
          [AwsEdgeDirectionSemantics.Authorizes]: {
            title: 'Authorizes',
            colour: '#8dd7c5',
          },
          [AwsEdgeDirectionSemantics.ObservedBy]: {
            title: 'Observed by telemetry',
            colour: '#20c997',
          },
        },
      },
    }),
  ],
});

export default legendSemanticsRuleSet;
