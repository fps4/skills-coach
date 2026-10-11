---
title: AWS CDK for Terraform users
summary: AWS CDK mapped onto the Terraform mental model — what it generates, what bites, how to test it, and when to choose which.
---

# AWS CDK for Terraform users

For someone deep in Terraform who needs to be productive in AWS CDK quickly. It maps CDK onto the
Terraform mental model rather than teaching infrastructure as code from scratch.

---

## 1. What CDK actually is

CDK is **not** a competing provisioning engine. It is a *code generator* for CloudFormation. You
write TypeScript (or Python, Java, Go, C#), run `cdk synth`, and it emits a CloudFormation template.
CloudFormation then does the deploying, the drift handling, and the rollback.

```
Terraform:  .tf files ──▶ terraform plan ──▶ provider API calls ──▶ state file
CDK:        .ts files ──▶ cdk synth ──▶ CloudFormation template ──▶ CFN stack
```

Three consequences:

1. **There is no state file you manage.** CloudFormation holds the state, server-side, per stack.
   No S3 backend, no DynamoDB lock table, no `terraform state mv`. A genuine operational
   simplification.
2. **You are bounded by CloudFormation.** If CloudFormation does not support a resource or property,
   CDK cannot either — except through custom resources (a Lambda that calls the API for you).
   Terraform providers are often ahead.
3. **Rollback is automatic and sometimes painful.** A failed CloudFormation deploy rolls the whole
   stack back. This is safer than a half-applied Terraform plan, but a stack stuck in
   `UPDATE_ROLLBACK_FAILED` is a worse day than a `terraform state` fix.

## 2. Vocabulary mapping

| Terraform | CDK | Notes |
|---|---|---|
| Resource | L1 construct (`CfnBucket`) | 1:1 with the CloudFormation resource, no defaults |
| Resource with sensible defaults | L2 construct (`s3.Bucket`) | The normal thing you write. Adds sane defaults, helper methods, IAM grants |
| Module | L3 construct / "pattern" | e.g. `aws-apigateway.LambdaRestApi`. Also just: your own class |
| Root module / workspace | Stack | Unit of deployment; maps to one CloudFormation stack |
| — | App | The program; contains one or more stacks |
| Variables (`var`) | Constructor props | Plain typed function arguments |
| Outputs | `CfnOutput` / class properties | Cross-stack refs are typed object references, not string lookups |
| `terraform plan` | `cdk diff` | Diffs synthesized template vs deployed stack |
| `terraform apply` | `cdk deploy` | |
| `terraform destroy` | `cdk destroy` | |
| Provider config | `env: { account, region }` on the Stack | |
| Remote state / `terraform_remote_state` | Direct object reference between stacks | It is just a variable |
| `count` / `for_each` | A `for` loop in TypeScript | The headline CDK advantage |
| `depends_on` | `node.addDependency()` | Usually inferred automatically from references |
| Provisioners | Custom resources (Lambda-backed) | |
| Terratest / `terraform validate` | `assertions` module + Jest snapshots | Unit-test the synthesized template |

## 3. The shape of a CDK stack

```ts
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface EventPlatformProps {
  readonly busName: string;
  readonly domains: string[];          // one queue + consumer per domain
}

export class EventPlatformStack extends cdk.Stack {
  public readonly bus: events.EventBus;

  constructor(scope: Construct, id: string, props: EventPlatformProps & cdk.StackProps) {
    super(scope, id, props);

    this.bus = new events.EventBus(this, 'Bus', { eventBusName: props.busName });

    for (const domain of props.domains) {          // <-- this is why people like CDK
      const dlq = new sqs.Queue(this, `${domain}Dlq`, {
        retentionPeriod: cdk.Duration.days(14),
      });

      const queue = new sqs.Queue(this, `${domain}Queue`, {
        visibilityTimeout: cdk.Duration.seconds(180),
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      });

      new events.Rule(this, `${domain}Rule`, {
        eventBus: this.bus,
        eventPattern: { source: [`acme.${domain}`] },
        targets: [new targets.SqsQueue(queue)],
      });

      const fn = new lambda.Function(this, `${domain}Consumer`, {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(`src/${domain}`),
        reservedConcurrentExecutions: 20,
      });

      queue.grantConsumeMessages(fn);   // <-- IAM policy generated for you
    }
  }
}
```

What the loop bought: strongly typed props, per-domain resources without `for_each` gymnastics, and
`grantConsumeMessages()` writing the least-privilege IAM policy instead of a hand-authored policy
document. That `grant*` family is the single biggest day-to-day quality-of-life difference from
Terraform.

## 4. Things that bite Terraform people

- **Logical IDs are path-derived.** The construct tree path (`Stack/Domain/Queue`) hashes into the
  CloudFormation logical ID. **Renaming a construct destroys and recreates the resource.** There is
  no `terraform state mv` equivalent; you use `overrideLogicalId()` or accept replacement. Plan
  construct IDs like resource addresses.
- **Escape hatches are normal, not a smell.** When an L2 construct does not expose a property, drop
  to the L1: `const cfnQueue = queue.node.defaultChild as sqs.CfnQueue;
  cfnQueue.addPropertyOverride('...', ...)`.
- **`cdk bootstrap` is a prerequisite.** Each account/region needs a bootstrap stack (S3 asset
  bucket, ECR repo, deploy roles) before anything deploys.
- **Assets change deployments.** Lambda code, Docker images and file assets are uploaded to the
  bootstrap bucket/ECR and referenced by hash. This is why CDK handles Lambda packaging so much
  better than raw Terraform — but `cdk deploy` needs build tooling available.
- **CloudFormation limits leak through.** 500 resources per stack, 1 MB template size. Large
  platforms split into multiple stacks; CDK makes cross-stack refs easy, but they create
  deploy-order coupling, and CloudFormation exports cannot be changed while in use — a classic trap.
- **`cdk diff` is weaker than `terraform plan`.** It diffs templates, so it shows "this property
  changes" without always making the real-world impact obvious.

## 5. Testing — the honest advantage

```ts
import { Template, Match } from 'aws-cdk-lib/assertions';

test('every domain queue has a DLQ with 5 retries', () => {
  const app = new cdk.App();
  const stack = new EventPlatformStack(app, 'Test', {
    busName: 'test-bus', domains: ['orders', 'billing'],
  });
  const t = Template.fromStack(stack);

  t.resourceCountIs('AWS::SQS::Queue', 4);           // 2 main + 2 DLQ
  t.hasResourceProperties('AWS::SQS::Queue', {
    RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
  });
});
```

This is a real argument for CDK on a *platform* team: guardrails ("every queue must have a DLQ",
"no public bucket") become unit tests and **Aspects** that visit every construct in the tree.
Terraform's equivalents (Sentinel, OPA, `tflint`) exist but are a separate toolchain.

## 6. When to choose which

**Choose CDK when:**
- The workload is AWS-only and serverless-heavy (Lambda packaging, Step Functions, EventBridge) —
  CDK's asset handling and L2 defaults save real time.
- Application developers own their own infrastructure and already write TypeScript; keeping infra
  in the same language and repo lowers the barrier.
- You want programmatic abstractions and unit-testable guardrails over many similar resources.

**Choose Terraform when:**
- The estate is multi-cloud or has non-AWS providers in the loop (identity providers, observability
  vendors, CDNs, source control, managed data platforms) — this is decisive, and it is the reality of
  most enterprise platform teams.
- You want an explicit, reviewable plan before every change, and fine-grained state surgery when
  things drift.
- Platform consumers are not developers and you want declarative HCL over a general-purpose
  language (a real risk with CDK: infra code that is too clever to review).

**A common and defensible split:** Terraform owns the foundation and anything cross-provider
(accounts, networking, IAM baseline, gateway, identity, observability integrations); CDK owns
per-service serverless application stacks that product teams deploy themselves. The reasoning is
about who operates what, not which tool is nicer.

**Also know it exists:** **CDKTF** (CDK for Terraform) gives the CDK programming model with
Terraform as the engine — an option when a team wants TypeScript constructs but must keep
multi-provider Terraform.

## 7. Half-day hands-on plan

1. `npm install -g aws-cdk`, `cdk init app --language typescript`, `cdk bootstrap`.
2. Build the event-platform stack sketched in §3: custom bus, two rules, two SQS queues with DLQs,
   two Lambda consumers.
3. Run `cdk synth` and **read the generated CloudFormation** — the step that makes CDK click.
   Notice how much IAM was written for you.
4. Rename a construct ID, run `cdk diff`, and watch the replacement.
5. Write the two assertion tests from §5.
6. Add an Aspect that fails synthesis if any SQS queue lacks a DLQ.
7. `cdk destroy`.
