import {
  PACKAGE_NAMESPACE,
  conventionName,
  profileName,
  pluginId,
  ruleName,
  ruleSetName,
} from './namespaces.js';
import { Convention } from './conventions/index.js';

describe('namespaces helpers', () => {
  it('shoud prefix identifiers with the package namespace', () => {
    expect(PACKAGE_NAMESPACE).toBe('@terra-graph-conventions/aws');
    expect(pluginId('aws.AwsS3')).toBe(
      '@terra-graph-conventions/aws:plugin:aws.AwsS3',
    );
    expect(ruleName('data.remove')).toBe(
      '@terra-graph-conventions/aws:rule:data.remove',
    );
    expect(ruleSetName('dot.sqs.dlq')).toBe(
      '@terra-graph-conventions/aws:ruleset:dot.sqs.dlq',
    );
    expect(profileName('core')).toBe(
      '@terra-graph-conventions/aws:profile:core',
    );
  });

  it('shoud compose convention-aware names', () => {
    expect(conventionName(Convention.DataFlow, 'dot')).toBe(
      'convention:dataflow:dot',
    );
    expect(conventionName(Convention.DataFlow, ruleName('legend'))).toBe(
      'convention:dataflow:@terra-graph-conventions/aws:rule:legend',
    );
  });
});
