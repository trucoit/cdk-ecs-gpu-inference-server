import { Construct } from 'constructs';
import { Size } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { AcceleratorManufacturer, AcceleratorType } from 'aws-cdk-lib/aws-ec2';
import { GpuInstanceRequirements } from '../types';

/**
 * Creates an ECS **Managed Instances** capacity provider that selects GPU
 * instances by attribute (not a fixed type/AMI), and associates it with the
 * cluster.
 *
 * Managed Instances launches, patches, and drains the underlying EC2 GPU hosts
 * for us — the equivalent of the source sample's `MANAGED_INSTANCES` capacity
 * provider. The infrastructure role and instance profile are created by the L2
 * construct with the AWS-managed policies when not supplied.
 */
export function createGpuCapacityProvider(
  scope: Construct,
  id: string,
  cluster: ecs.Cluster,
  subnets: ec2.ISubnet[],
  securityGroups: ec2.ISecurityGroup[],
  requirements?: GpuInstanceRequirements,
): ecs.ManagedInstancesCapacityProvider {
  const provider = new ecs.ManagedInstancesCapacityProvider(scope, id, {
    subnets,
    securityGroups,
    // On-demand for predictable inference latency; consumers can extend this later.
    capacityOptionType: ecs.CapacityOptionType.ON_DEMAND,
    instanceRequirements: {
      // GPU selection: a single NVIDIA GPU. The defaults keep the pool cheap by
      // allowing 16 GiB-VRAM parts (T4, e.g. g4dn) and capping vCPU/memory, so
      // ECS does not reach for large boxes. Raise these for bigger models.
      acceleratorTypes: [AcceleratorType.GPU],
      acceleratorManufacturers: [AcceleratorManufacturer.NVIDIA],
      acceleratorCountMin: requirements?.acceleratorCountMin ?? 1,
      acceleratorCountMax: requirements?.acceleratorCountMax ?? 1,
      acceleratorTotalMemoryMin: requirements?.acceleratorTotalMemoryMin ?? Size.mebibytes(16384),
      vCpuCountMin: requirements?.vCpuCountMin ?? 4,
      vCpuCountMax: requirements?.vCpuCountMax ?? 16,
      memoryMin: requirements?.memoryMin ?? Size.mebibytes(16384),
      memoryMax: requirements?.memoryMax ?? Size.mebibytes(65536),
    },
  });

  cluster.addManagedInstancesCapacityProvider(provider);
  return provider;
}
