import { StackProps, Aws, Stack, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export class MenuManagementSystemStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const usersTable = new dynamodb.Table(this, "users-table", {
      tableName: `${Aws.STACK_NAME}-users`,
      partitionKey: { name: "userid", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new CfnOutput(this, "UsersTable", {
      description: "DynamoDB Users table",
      value: usersTable.tableName,
    });
  }
}
