import { StackProps, Aws, Stack, RemovalPolicy, CfnOutput, Duration, Tags, CfnParameter } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambda_nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as fs from "fs";
import * as logs from 'aws-cdk-lib/aws-logs';

export class MenuManagementSystemStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const usersTable = new dynamodb.Table(this, "users-table", {
      tableName: `${Aws.STACK_NAME}-users`,
      partitionKey: { name: "userid", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new CfnOutput(this, "UsersTable", {
      description: "DynamoDB Users table",
      value: usersTable.tableName,
    });

    const nodejsFunctionProps = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 128,
      timeout: Duration.seconds(100),
      tracing: lambda.Tracing.ACTIVE,
    };

    const usersFunction = new lambda_nodejs.NodejsFunction(this, "users-function", {
      entry: "./src/api/users/index.ts",
      handler: "handler",
      ...nodejsFunctionProps,
      environment: {
        USERS_TABLE: usersTable.tableName,
      },
    });
    usersTable.grantReadWriteData(usersFunction);
    Tags.of(usersFunction).add("Stack", `${Aws.STACK_NAME}`);

    new CfnOutput(this, "UsersFunction", {
      description: "Lambda function used to perform actions on the users data",
      value: usersFunction.functionName,
    });

    const menusFunction = new lambda_nodejs.NodejsFunction(this, "menus-function", {
      entry: "./src/api/menus/index.ts",
      handler: "handler",
      ...nodejsFunctionProps,
      environment: {
        USERS_TABLE: usersTable.tableName,
      },
    });
    usersTable.grantReadWriteData(menusFunction);
    Tags.of(menusFunction).add("Stack", `${Aws.STACK_NAME}`);

    new CfnOutput(this, "MenusFunction", {
      description: "Lambda function used to perform actions on the menus data",
      value: menusFunction.functionName,
    });

    const authorizerFunction = new lambda_nodejs.NodejsFunction(this, "authorizer-function", {
      entry: "./src/api/authorizer/index.ts",
      handler: "handler",
      ...nodejsFunctionProps,
    });
    Tags.of(authorizerFunction).add("Stack", `${Aws.STACK_NAME}`);

    const authorizer = new apigateway.TokenAuthorizer(this, "api-authorizer", {
      handler: authorizerFunction,
    });

    const logGroup = new logs.LogGroup(this, 'api-access-logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      logGroupName: `/${Aws.STACK_NAME}/ApiAccessLogs`,
    });

    const api = new apigateway.RestApi(this, "users-api", {
      defaultMethodOptions: { authorizer },
      cloudWatchRole: true,
      deployOptions: {
        stageName: "prod",
        tracingEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          ip: true,
          caller: true,
          user: true,
          requestTime: true,
          httpMethod: true,
          resourcePath: true,
          status: true,
          protocol: true,
          responseLength: true,
        }),
        methodOptions: {
          '/*/*': {
            loggingLevel: apigateway.MethodLoggingLevel.INFO,
            dataTraceEnabled: true,
          }
        }
      },
    });
    Tags.of(api).add("Name", `${Aws.STACK_NAME}-api`);
    Tags.of(api).add("Stack", `${Aws.STACK_NAME}`);

    new CfnOutput(this, "UsersApi", {
      description: "API Gateway endpoint URL",
      value: api.url,
    });

    const users = api.root.addResource("users");
    users.addMethod("GET", new apigateway.LambdaIntegration(usersFunction));
    users.addMethod("POST", new apigateway.LambdaIntegration(usersFunction));

    const user = users.addResource("{userid}");
    user.addMethod("DELETE", new apigateway.LambdaIntegration(usersFunction));
    user.addMethod("GET", new apigateway.LambdaIntegration(usersFunction));
    user.addMethod("PUT", new apigateway.LambdaIntegration(usersFunction));

    const menus = api.root.addResource("menus");
    menus.addMethod("GET", new apigateway.LambdaIntegration(menusFunction));
    menus.addMethod("POST", new apigateway.LambdaIntegration(menusFunction));

    const menu = menus.addResource("{menuid}");
    menu.addMethod("PUT", new apigateway.LambdaIntegration(menusFunction));

    const userPool = new cognito.UserPool(this, "user-pool", {
      userPoolName: `${Aws.STACK_NAME}-user-pool`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
    });
    Tags.of(userPool).add("Name", `${Aws.STACK_NAME}-user-pool`);
    authorizerFunction.addEnvironment('USER_POOL_ID', userPool.userPoolId);

    const apiAdminGroupName = new CfnParameter(this, "api-admin-group-name", {
      description: "User pool group name for API adminstrators",
      type: "String",
      default: "apiAdmins",
    });

    const userPoolClient = userPool.addClient("user-pool-client", {
      userPoolClientName: `${Aws.STACK_NAME}-user-pool-client`,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      refreshTokenValidity: Duration.days(30),
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.GOOGLE],
      oAuth: {
        flows: {
          implicitCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID],
        callbackUrls: ["http://localhost"],
      },
    });

    const userPoolClientId = userPoolClient.userPoolClientId;
    authorizerFunction.addEnvironment('APPLICATION_CLIENT_ID', userPoolClientId);

    const userPoolDomain = userPool.addDomain("user-pool-domain", {
      cognitoDomain: {
        domainPrefix: `menu`,
      },
    });

    const adminGroup = new cognito.CfnUserPoolGroup(this, "api-admin-group", {
      description: "User group for API Administrators",
      groupName: apiAdminGroupName.valueAsString,
      precedence: 0,
      userPoolId: userPool.userPoolId,
    });
    authorizerFunction.addEnvironment('ADMIN_GROUP_NAME', adminGroup.groupName || '');

    // Configure federation - example with Google
    const envConfig = JSON.parse(fs.readFileSync("./lib/env.json", "utf8"));
    const clientId = envConfig.GOOGLE_CLIENT_ID;
    const clientSecret = envConfig.GOOGLE_CLIENT_SECRET;

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleProvider", {
      userPool,
      clientId: clientId || "", // Accessed from environment variables
      clientSecret: clientSecret || "",
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        phoneNumber: cognito.ProviderAttribute.GOOGLE_PHONE_NUMBERS,
      },
      scopes: ["profile", "email", "openid"],
    });

    // Attach the Google provider to your user pool
    userPool.registerIdentityProvider(googleProvider);

    new CfnOutput(this, "UserPool", {
      description: "Cognito User Pool ID",
      value: userPool.userPoolId,
    });

    new CfnOutput(this, "UserPoolClient", {
      description: "Cognito User Pool Application Client ID",
      value: userPoolClientId,
    });

    new CfnOutput(this, "UserPoolAdminGroupName ", {
      description: "Cognito User Pool Admin Group Name",
      value: adminGroup.groupName || "",
    });

    new CfnOutput(this, "CognitoLoginURL", {
      description: "Cognito User Pool Application Client Hosted Login UI URL",
      value: `https://menu.auth.${Aws.REGION}.amazoncognito.com/login?client_id=${userPoolClientId}&response_type=code&redirect_uri=http://localhost`,
    });

    new CfnOutput(this, "CognitoAuthCommand", {
      description: "AWS CLI command for Amazon Cognito User Pool authentication",
      value: `aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id ${userPoolClientId} --auth-parameters USERNAME=<user@example.com>,PASSWORD=<password>`,
    });
  }
}
