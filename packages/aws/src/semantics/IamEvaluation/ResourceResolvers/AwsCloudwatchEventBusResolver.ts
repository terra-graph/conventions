import { DefaultResolver } from './DefaultResolver.js';

export class AwsCloudwatchEventBusResolver extends DefaultResolver {
  public override resourceNamePatternFromArnPattern(resourcePattern: string): string | undefined {
    const match = resourcePattern.match(/^arn:[^:]*:events:[^:]*:[^:]*:event-bus\/(.+)$/);
    return match?.[1];
  }
}
