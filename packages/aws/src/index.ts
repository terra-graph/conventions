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
import { AwsApiGateway } from './plugins/AwsApiGateway.js';
import { AwsIamGraphPlugin } from './plugins/AwsIam.js';
import { AwsS3 } from './plugins/AwsS3.js';
import { AwsSns } from './plugins/AwsSns.js';
import { AwsTransferFamily } from './plugins/AwsTransferFamily.js';
import dotRules from './rules/dot.js';
import generalRules from './rules/general.js';
import dotRuleSet from './rulesets/dot.js';

export default (): RuntimeProvider => ({
  namedRules: NamedRuleRegistry.from([generalRules, dotRules, dataFlowConventionRules]),
  namedRuleSets: NamedRuleSetRegistry.from([dotRuleSet, dataflowConventionRuleSet]),
  profiles: new ProfileRegistry({
    [conventionDataFlowDotProfileName]: conventionDataFlowDotProfile,
    [conventionDataFlowBaseProfileName]: conventionDataFlowBaseProfile,
  }),
  plugins: new GraphPluginRegistry({
    [AwsApiGateway.id]: new AwsApiGateway(),
    [AwsIamGraphPlugin.id]: new AwsIamGraphPlugin(),
    [AwsS3.id]: new AwsS3(),
    [AwsSns.id]: new AwsSns(),
    [AwsTransferFamily.id]: new AwsTransferFamily(),
  }),
  supportedAdapterOperationsRegistry: {
    DotAdapter,
    // GraphologyAdapter,
  },
});
