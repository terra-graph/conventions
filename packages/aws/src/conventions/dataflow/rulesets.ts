import { NamedRuleSetRegistry, RuleSet } from 'terra-graph';
import { conventionName, ruleName, ruleSetName } from '../../namespaces.js';
import { Convention } from '../index.js';

export default new NamedRuleSetRegistry({
  [conventionName(Convention.DataFlow, ruleSetName('semantics'))]: new RuleSet({
    rules: [
      { namedRule: conventionName(Convention.DataFlow, ruleName('authorizes.iam_to_targets')) },
      {
        namedRule: conventionName(
          Convention.DataFlow,
          ruleName('authorizes.non_iam_policies_to_targets'),
        ),
      },
      {
        namedRule: conventionName(
          Convention.DataFlow,
          ruleName('authorizes.lambda_permissions_to_targets'),
        ),
      },
      {
        namedRule: conventionName(Convention.DataFlow, ruleName('observed_by.telemetry_targets')),
      },
      {
        namedRule: conventionName(Convention.DataFlow, ruleName('publishes.producers_to_brokers')),
      },
      {
        namedRule: conventionName(
          Convention.DataFlow,
          ruleName('triggers.async_sources_to_consumers'),
        ),
      },
      {
        namedRule: conventionName(Convention.DataFlow, ruleName('accesses.compute_to_data_stores')),
      },
      { namedRule: conventionName(Convention.DataFlow, ruleName('invokes.sync_request_calls')) },
      {
        namedRule: conventionName(Convention.DataFlow, ruleName('routes.routing_tier_to_services')),
      },
      {
        namedRule: conventionName(
          Convention.DataFlow,
          ruleName('routes.catalog_database_to_table'),
        ),
      },
      { namedRule: conventionName(Convention.DataFlow, ruleName('legend')) },
    ],
  }),
});
