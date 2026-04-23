import { EdgeDirectionSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeDirectionSemantics } from '../edgeSemantics.js';

export const glueSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_glue_catalog_database'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_glue_catalog_table'],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeDirectionSemantic({
      edge: {
        from: {
          attr: {
            key: 'terraform.resource',
            in: ['aws_glue_job', 'aws_glue_catalog_table', 'aws_glue_catalog_database'],
          },
        },
        to: {
          attr: {
            key: 'terraform.resource',
            startsWith: [
              'aws_dynamodb_',
              'aws_s3_',
              'aws_rds_',
              'aws_docdb_',
              'aws_elasticache_',
              'aws_opensearch_',
              'aws_timestream',
              'aws_redshift_',
              'aws_secretsmanager_secret_version',
            ],
          },
        },
      },
      options: {
        semantic: AwsEdgeDirectionSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default glueSemanticsRuleSet;
