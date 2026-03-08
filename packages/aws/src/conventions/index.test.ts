import { Convention } from './index.js';

describe('Convention enum', () => {
  it('shoud expose the dataflow convention namespace', () => {
    expect(Convention.DataFlow).toBe('dataflow');
  });
});
