import { DefaultResolver } from './DefaultResolver.js';

export class AwsDynamoDbTableResolver extends DefaultResolver {
  public override resourceNamePatternFromArnPattern(resourcePattern: string): string | undefined {
    const match = resourcePattern.match(/^arn:[^:]*:dynamodb:[^:]*:[^:]*:table\/(.+)$/);
    return match?.[1];
  }
}
