import {
  ConvertNodeToEdge,
  EdgeReverse,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';

export class AwsSns extends GraphPlugin {
  static id = pluginId(`aws.${AwsSns.name}`);

  constructor() {
    super(AwsSns.id);
  }

  public override build(_input: GraphPluginBuildInput): GraphPluginBuildResult {
    return {
      phases: [
        {
          phase: 'main',
          rules: [
            new EdgeReverse({
              edge: {
                from: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_sns_topic',
                  },
                },
                to: {
                  attr: {
                    key: 'terraform.resource',
                    eq: 'aws_sns_topic_subscription',
                  },
                },
              },
            }),
          ],
        },
        {
          phase: 'main',
          rules: [
            new ConvertNodeToEdge({
              node: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_sns_topic_subscription',
                },
              },
            }),
          ],
        },
      ],
    };
  }
}
