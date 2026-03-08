import dataFlowConventionRules from './rules.js';
import { Convention } from '../index.js';
import { conventionName, ruleName } from '../../namespaces.js';

describe('dataflow convention rules', () => {
  const expectedRules = [
    conventionName(Convention.DataFlow, ruleName('authorizes.iam_to_targets')),
    conventionName(
      Convention.DataFlow,
      ruleName('authorizes.non_iam_policies_to_targets'),
    ),
    conventionName(
      Convention.DataFlow,
      ruleName('authorizes.lambda_permissions_to_targets'),
    ),
    conventionName(
      Convention.DataFlow,
      ruleName('observed_by.telemetry_targets'),
    ),
    conventionName(
      Convention.DataFlow,
      ruleName('publishes.producers_to_brokers'),
    ),
    conventionName(
      Convention.DataFlow,
      ruleName('triggers.async_sources_to_consumers'),
    ),
    conventionName(
      Convention.DataFlow,
      ruleName('accesses.compute_to_data_stores'),
    ),
    conventionName(Convention.DataFlow, ruleName('invokes.sync_request_calls')),
    conventionName(Convention.DataFlow, ruleName('routes.routing_tier_to_services')),
    conventionName(Convention.DataFlow, ruleName('routes.catalog_database_to_table')),
    conventionName(Convention.DataFlow, ruleName('legend')),
  ];

  it('shoud register all expected dataflow rules', () => {
    expect(dataFlowConventionRules.names().sort()).toStrictEqual(
      expectedRules.sort(),
    );
  });

  it('shoud resolve IAM authorization rule semantics', () => {
    const rule = dataFlowConventionRules.resolve(
      conventionName(Convention.DataFlow, ruleName('authorizes.iam_to_targets')),
    );
    expect(rule.serialize()).toStrictEqual({
      id: 'EdgeDirectionSemantic',
      config: {
        edge: {
          from: {
            attr: {
              key: 'terraform.resource',
              startsWith: 'aws_iam_',
            },
          },
          to: {
            any: true,
          },
        },
        options: {
          semantic: 'authorizes',
        },
      },
    });
  });

  it('shoud resolve legend semantic rule as an edge legend', () => {
    const legendId = dataFlowConventionRules.resolve(
      conventionName(Convention.DataFlow, ruleName('legend')),
    );

    expect(legendId.serialize().id).toBe('EdgeSemanticLegend');
    expect(legendId.serialize().config.options?.legendBySemantic).toBeDefined();
  });
});
