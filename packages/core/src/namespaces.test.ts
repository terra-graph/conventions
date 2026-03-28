import { PACKAGE_NAMESPACE, pluginId, profileName, ruleName, ruleSetName } from './namespaces.js';

describe('namespaces helpers', () => {
  it('shoud prefix identifiers with the package namespace', () => {
    expect(PACKAGE_NAMESPACE).toBe('@terra-graph/conventions-core');
    expect(pluginId('aws.AwsS3')).toBe('@terra-graph/conventions-core:plugin:aws.AwsS3');
    expect(ruleName('data.remove')).toBe('@terra-graph/conventions-core:rule:data.remove');
    expect(ruleSetName('dot.sqs.dlq')).toBe('@terra-graph/conventions-core:ruleset:dot.sqs.dlq');
    expect(profileName('core')).toBe('@terra-graph/conventions-core:profile:core');
  });
});
