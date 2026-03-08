import {
  ConvertNodeToEdge,
  GraphPlugin,
  type GraphPluginBuildInput,
  type GraphPluginBuildResult,
  RemoveNode,
  RemoveNodeAndReconnectEdges,
} from 'terra-graph';
import { pluginId } from '../namespaces.js';
export type S3GraphPluginOptions = {
  keepResources?: string[];
};

const S3_DEFAULT_KEEP_RESOURCES = ['aws_s3_bucket', 'aws_s3_bucket_notification'];

export type S3GraphPluginConstructorOptions = {
  keepResources?: string[];
};

export class AwsS3 extends GraphPlugin<S3GraphPluginOptions> {
  static id = pluginId(`aws.${AwsS3.name}`);

  constructor(options: S3GraphPluginConstructorOptions = {}) {
    const keepResources = Array.isArray(options.keepResources)
      ? options.keepResources
      : S3_DEFAULT_KEEP_RESOURCES;

    super(AwsS3.id, {
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
          phase: 'main',
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
          phase: 'main',
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
            new ConvertNodeToEdge({
              node: {
                attr: {
                  key: 'terraform.resource',
                  eq: 'aws_s3_bucket_notification',
                },
              },
            }),
          ],
        },
      ],
    };
  }
}
