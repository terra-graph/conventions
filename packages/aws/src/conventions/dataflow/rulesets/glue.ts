import { EdgeSemantic, RuleSet } from '@terra-graph/core';
import { AwsEdgeSemantics } from '../edgeSemantics.js';

export const glueSemanticsRuleSet = new RuleSet({
  rules: [
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Routes,
        enforceDirection: true,
      },
    }),
    new EdgeSemantic({
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
        semantic: AwsEdgeSemantics.Accesses,
        enforceDirection: true,
      },
    }),
  ],
});

export default glueSemanticsRuleSet;
