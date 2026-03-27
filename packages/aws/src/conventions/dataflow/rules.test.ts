import dataFlowConventionRules from './rules.js';

describe('dataflow convention rules', () => {
  it('shoud export an empty registry', () => {
    expect(dataFlowConventionRules.names()).toEqual([]);
  });
});
