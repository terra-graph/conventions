import { DefaultResolver } from './DefaultResolver.js';

export class AwsSfnStateMachineResolver extends DefaultResolver {
  public override resourceNamePatternFromArnPattern(resourcePattern: string): string | undefined {
    const match = resourcePattern.match(/^arn:[^:]*:states:[^:]*:[^:]*:stateMachine:(.+)$/);
    return match?.[1];
  }
}
