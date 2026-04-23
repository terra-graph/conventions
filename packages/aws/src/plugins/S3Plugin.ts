import {
  ConvertNodeToEdge,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  RemoveNode,
  RemoveNodeAndReconnectEdges,
} from '@terra-graph/core';
import { pluginId } from '../namespaces.js';
export type S3GraphPluginOptions = {
  keepResources?: string[];
};

const S3_DEFAULT_KEEP_RESOURCES = ['aws_s3_bucket', 'aws_s3_bucket_notification'];

export type S3GraphPluginConstructorOptions = {
  keepResources?: string[];
};
// TODO: this feels like part of conventions not a usefule plugin
export class S3Plugin extends GraphPlugin<S3GraphPluginOptions> {
  static id = pluginId(`aws.${S3Plugin.name}`);

  constructor(options: S3GraphPluginConstructorOptions = {}) {
    const keepResources = Array.isArray(options.keepResources)
      ? options.keepResources
      : S3_DEFAULT_KEEP_RESOURCES;

    super(S3Plugin.id, {
      keepResources: [...keepResources],
    });
  }

  public override build({
    options,
  }: GraphPluginBuildInput<S3GraphPluginOptions>): GraphPluginBuildResult {
    const keepResources = Array.isArray(options.keepResources)
      ? options.keepResources
      : S3_DEFAULT_KEEP_RESOURCES;

    return {
      phases: [
        {
          phase: 'pre',
          rules: [
            new RemoveNodeAndReconnectEdges({
              node: {
                and: [
                  {
                    attr: {
                      key: 'terraform.resource',
                      startsWith: 'aws_s3_',
                    },
                  },
                  {
                    not: {
                      attr: {
                        key: 'terraform.resource',
                        in: keepResources,
                      },
                    },
                  },
                ],
              },
            }),
            // new EdgeReverse({
            //   edge: {
            //     from: {
            //       attr: {
            //         key: 'terraform.resource',
            //         eq: 'aws_s3_bucket',
            //       },
            //     },
            //     to: {
            //       attr: {
            //         key: 'terraform.resource',
            //         eq: 'aws_s3_bucket_notification',
            //       },
            //     },
            //   },
            // }),
          ],
        },
        {
          phase: 'pre',
          rules: [
            new RemoveNode({
              node: {
                and: [
                  {
                    attr: {
                      key: 'terraform.resource',
                      eq: 'aws_s3_bucket_object',
                    },
                  },
                  {
                    not: {
                      attr: {
                        key: 'terraform.resource',
                        in: keepResources,
                      },
                    },
                  },
                ],
              },
            }),
          ],
        },
        {
          phase: 'main',
          rules: [
            // new ConvertNodeToEdge({
            //   node: {
            //     attr: {
            //       key: 'terraform.resource',
            //       eq: 'aws_s3_bucket_notification',
            //     },
            //   },
            // }),
          ],
        },
      ],
    };
  }
}
