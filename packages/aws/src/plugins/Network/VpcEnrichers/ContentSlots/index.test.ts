import { resolveAwsSubnetContentSlot } from './index.js';

describe('resolveAwsSubnetContentSlot', () => {
  it('shoud resolve explicit slot classifications for known subnet-scoped resources', () => {
    expect(resolveAwsSubnetContentSlot('aws_lb')).toStrictEqual({
      slotKey: 'ingress',
      slotOrder: 10,
    });
    expect(resolveAwsSubnetContentSlot('aws_nat_gateway')).toStrictEqual({
      slotKey: 'network',
      slotOrder: 20,
    });
    expect(resolveAwsSubnetContentSlot('aws_instance')).toStrictEqual({
      slotKey: 'application',
      slotOrder: 30,
    });
    expect(resolveAwsSubnetContentSlot('aws_efs_mount_target')).toStrictEqual({
      slotKey: 'storage',
      slotOrder: 40,
    });
    expect(resolveAwsSubnetContentSlot('aws_db_subnet_group')).toStrictEqual({
      slotKey: 'data',
      slotOrder: 50,
    });
  });

  it('shoud fall back to the generic workload slot for unclassified resources', () => {
    expect(resolveAwsSubnetContentSlot('aws_opensearch_ingestion_pipeline')).toStrictEqual({
      slotKey: 'workload',
      slotOrder: 90,
    });
  });

  it('shoud exclude container resources and undefined resources', () => {
    expect(resolveAwsSubnetContentSlot('aws_subnet')).toBeUndefined();
    expect(resolveAwsSubnetContentSlot('aws_vpc')).toBeUndefined();
    expect(resolveAwsSubnetContentSlot(undefined)).toBeUndefined();
  });
});
