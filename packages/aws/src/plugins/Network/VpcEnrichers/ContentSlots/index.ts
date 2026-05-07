export type AwsSubnetContentSlot = {
  slotKey: string;
  slotOrder: number;
};

type AwsSubnetContentSlotRule = AwsSubnetContentSlot & {
  test: RegExp;
};

const SUBNET_CONTENT_SLOT_RULES: AwsSubnetContentSlotRule[] = [
  {
    slotKey: 'ingress',
    slotOrder: 10,
    test: /^aws_(lb|lb_listener|lb_target_group)$/,
  },
  {
    slotKey: 'network',
    slotOrder: 20,
    test: /^aws_(nat_gateway|vpc_endpoint|network_interface)$/,
  },
  {
    slotKey: 'application',
    slotOrder: 30,
    test: /^aws_(instance|autoscaling_group|ecs_service|ecs_task_set|lambda_function|launch_template|launch_configuration|eks_node_group|eks_fargate_profile)$/,
  },
  {
    slotKey: 'storage',
    slotOrder: 40,
    test: /^aws_efs_(file_system|mount_target)$/,
  },
  {
    slotKey: 'data',
    slotOrder: 50,
    test: /^aws_(.+_subnet_group|db_instance|db_cluster|rds_cluster|redshift_cluster|docdb_.+|neptune_.+|elasticache_.+|opensearch_domain|msk_cluster)$/,
  },
];

const SUBNET_CONTENT_SLOT_FALLBACK: AwsSubnetContentSlot = {
  slotKey: 'workload',
  slotOrder: 90,
};

const SUBNET_CONTENT_SLOT_EXCLUSIONS = new Set<string>(['aws_subnet', 'aws_vpc']);

export const resolveAwsSubnetContentSlot = (
  resource: string | undefined,
): AwsSubnetContentSlot | undefined => {
  if (!resource || SUBNET_CONTENT_SLOT_EXCLUSIONS.has(resource)) {
    return undefined;
  }

  const matchedRule = SUBNET_CONTENT_SLOT_RULES.find((rule) => rule.test.test(resource));
  if (matchedRule) {
    return {
      slotKey: matchedRule.slotKey,
      slotOrder: matchedRule.slotOrder,
    };
  }

  return SUBNET_CONTENT_SLOT_FALLBACK;
};
