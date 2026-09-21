import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { InferenceProtocol } from '../inference-container';

/** Optional ALB tuning for Mode B. */
export interface AlbOptions {
  /** Expose the ALB to the internet. @default false (internal) */
  readonly internetFacing?: boolean;
  /** Listener port. @default 443 when `certificate` is set, else 80 */
  readonly listenerPort?: number;
  /** ACM certificate ARN; when set the listener is HTTPS. @default - HTTP listener */
  readonly certificateArn?: string;
}

export interface AlbFrontendProps {
  readonly vpc: ec2.IVpc;
  readonly vpcSubnets: ec2.SubnetSelection;
  /** SG on the task ENIs; this module opens ingress from the ALB to the container port. */
  readonly taskSecurityGroup: ec2.ISecurityGroup;
  readonly containerPort: number;
  readonly protocol: InferenceProtocol;
  readonly healthCheckPath: string;
  readonly options?: AlbOptions;
}

/** The ALB, listener, and target group created for Mode B. */
export interface AlbFrontend {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly listener: elbv2.ApplicationListener;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
}

function targetProtocolVersion(protocol: InferenceProtocol): elbv2.ApplicationProtocolVersion {
  switch (protocol) {
    case 'GRPC':
      return elbv2.ApplicationProtocolVersion.GRPC;
    case 'HTTP2':
      return elbv2.ApplicationProtocolVersion.HTTP2;
    default:
      return elbv2.ApplicationProtocolVersion.HTTP1;
  }
}

/**
 * Fronts the model container with an Application Load Balancer (Mode B).
 *
 * The target group uses `IP` targets (required by `awsvpc` networking); ECS
 * registers the task ENIs itself via the service's `loadBalancers` config. The
 * ALB is allowed to reach the task security group on the container port.
 */
export function createAlbFrontend(scope: Construct, id: string, props: AlbFrontendProps): AlbFrontend {
  const options = props.options ?? {};
  const httpsCert = options.certificateArn;
  const internetFacing = options.internetFacing ?? false;

  const loadBalancer = new elbv2.ApplicationLoadBalancer(scope, id, {
    vpc: props.vpc,
    // An internet-facing ALB must sit in public subnets; let it pick them.
    // An internal ALB shares the task subnets provided by the caller.
    vpcSubnets: internetFacing ? { subnetType: ec2.SubnetType.PUBLIC } : props.vpcSubnets,
    internetFacing,
  });

  const protocolVersion = targetProtocolVersion(props.protocol);
  const targetGroup = new elbv2.ApplicationTargetGroup(scope, `${id}Targets`, {
    vpc: props.vpc,
    port: props.containerPort,
    protocol: elbv2.ApplicationProtocol.HTTP,
    protocolVersion,
    targetType: elbv2.TargetType.IP,
    healthCheck: {
      path: props.healthCheckPath,
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      // gRPC health checks report app-level status codes; 0 = OK.
      healthyGrpcCodes: protocolVersion === elbv2.ApplicationProtocolVersion.GRPC ? '0' : undefined,
    },
  });

  const listener = loadBalancer.addListener(`${id}Listener`, {
    port: options.listenerPort ?? (httpsCert ? 443 : 80),
    protocol: httpsCert ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
    certificates: httpsCert ? [elbv2.ListenerCertificate.fromArn(httpsCert)] : undefined,
    defaultTargetGroups: [targetGroup],
  });

  // Allow the ALB to reach the task ENIs on the model port.
  props.taskSecurityGroup.connections.allowFrom(
    loadBalancer,
    ec2.Port.tcp(props.containerPort),
    'ALB to model container',
  );

  return { loadBalancer, listener, targetGroup };
}
