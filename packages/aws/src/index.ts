import {
  DotAdapter,
  GraphPluginRegistry,
  NamedRuleRegistry,
  NamedRuleSetRegistry,
  ProfileRegistry,
  type RuntimeProvider,
} from '@terra-graph/core';
import conventionDataFlowBaseProfile, {
  conventionDataFlowBaseProfileName,
} from './conventions/dataflow/profiles/base.js';
import conventionDataFlowDotProfile, {
  conventionDataFlowDotProfileName,
} from './conventions/dataflow/profiles/dot.js';
import dataFlowConventionRules from './conventions/dataflow/rules.js';
import dataflowConventionRuleSet from './conventions/dataflow/rulesets.js';
import { AwsNetworkPlacementPlugin } from './plugins/Network/AwsNetworkPlacementPlugin.js';
import { VpcTopologyPlugin } from './plugins/Network/VpcTopologyPlugin.js';
import dotRules from './rules/dot.js';
import terraformRules from './rules/terraform.js';
import dotRuleSet from './rulesets/dot.js';
import './semantics/registerAll.js';

export * from './conventions/dataflow/edgeSemantics.js';
export * from './semantics/index.js';

export default (): RuntimeProvider => ({
  namedRules: NamedRuleRegistry.from([terraformRules, dotRules, dataFlowConventionRules]),
  namedRuleSets: NamedRuleSetRegistry.from([dotRuleSet, dataflowConventionRuleSet]),
  profiles: new ProfileRegistry({
    [conventionDataFlowDotProfileName]: conventionDataFlowDotProfile,
    [conventionDataFlowBaseProfileName]: conventionDataFlowBaseProfile,
  }),
  plugins: new GraphPluginRegistry({
    [AwsNetworkPlacementPlugin.id]: new AwsNetworkPlacementPlugin(),
    [VpcTopologyPlugin.id]: new VpcTopologyPlugin(),
  }),
  supportedAdapterOperationsRegistry: {
    DotAdapter,
    // GraphologyAdapter,
  },
});
