import * as semantics from './index.js';

describe('semantics index', () => {
  it('should re-export the semantic decorators', () => {
    expect(semantics.AwsIamPermissionSemanticDecorator).toBeDefined();
    expect(semantics.AwsPipeSemanticDecorator).toBeDefined();
    expect(semantics.AwsScheduleSemanticDecorator).toBeDefined();
    expect(semantics.AwsSqsDeadLetterSemanticDecorator).toBeDefined();
  });
});
