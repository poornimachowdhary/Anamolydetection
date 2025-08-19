import { App, Stack, RemovalPolicy, Duration, CfnParameter } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { TransactionDashboardStack } from '../src/lib/dashboard-stack';

describe('dashboard stack test suite', () => {
  let stack: Stack;

  beforeAll(() => {
    ({ stack } = initializeStackWithContextsAndEnvs({}));
  });

  beforeEach(() => {
  });

  test('docdb is created.', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::DocDB::DBClusterParameterGroup', {
      Family: 'docdb4.0',
      Parameters: {
        audit_logs: 'enabled',
      },
    });

    Template.fromStack(stack).hasResource('AWS::DocDB::DBCluster', {
      Properties: {
        MasterUsername: {
          'Fn::Join': [
            '',
            [
              '{{resolve:secretsmanager:',
              {
                Ref: 'DashboardDatabaseSecretCF9F4299',
              },
              ':SecretString:username::}}',
            ],
          ],
        },
        MasterUserPassword: {
          'Fn::Join': [
            '',
            [
              '{{resolve:secretsmanager:',
              {
                Ref: 'DashboardDatabaseSecretCF9F4299',
              },
              ':SecretString:password::}}',
            ],
          ],
        },
        BackupRetentionPeriod: 7,
        DBClusterParameterGroupName: {
          Ref: 'DashboardDBParameterGroupB9B62F6B',
        },
        EngineVersion: '4.0.0',
        Port: 27117,
        StorageEncrypted: true,
      },
      UpdateReplacePolicy: 'Delete',
      DeletionPolicy: 'Delete',
    });
  });

  test('SG of docdb.', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: {
        'Fn::GetAtt': [
          'DashboardDatabaseF93C7646',
          'Port',
        ],
      },
      GroupId: {
        'Fn::GetAtt': [
          'DashboardDatabaseSGAB493439',
          'GroupId',
        ],
      },
      SourceSecurityGroupId: {
        'Fn::GetAtt': [
          'DashboardToDocDBSGD91501D9',
          'GroupId',
        ],
      },
      ToPort: {
        'Fn::GetAtt': [
          'DashboardDatabaseF93C7646',
          'Port',
        ],
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      IpProtocol: 'tcp',
      FromPort: {
        'Fn::GetAtt': [
          'DashboardDatabaseF93C7646',
          'Port',
        ],
      },
      GroupId: {
        'Fn::GetAtt': [
          'DashboardDatabaseSGAB493439',
          'GroupId',
        ],
      },
      SourceSecurityGroupId: {
        'Fn::GetAtt': [
          'CreateIndexOfDocDBSG8E379620',
          'GroupId',
        ],
      },
      ToPort: {
        'Fn::GetAtt': [
          'DashboardDatabaseF93C7646',
          'Port',
        ],
      },
    });
  });

  test('rotating password of DocDB', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
      SecretId: {
        Ref: 'DashboardDatabaseSecretAttachmentB749CF34',
      },
      RotationLambdaARN: {
        'Fn::GetAtt': [
          'DashboardDatabaseRotationSingleUser0EB18E12',
          'Outputs.RotationLambdaARN',
        ],
      },
      RotationRules: {
        AutomaticallyAfterDays: 30,
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::SecretsManager::ResourcePolicy', {
      ResourcePolicy: {
        Statement: [
          {
            Action: 'secretsmanager:DeleteSecret',
            Effect: 'Deny',
            Principal: {
              AWS: {
                'Fn::Join': [
                  '',
                  [
                    'arn:',
                    {
                      Ref: 'AWS::Partition',
                    },
                    ':iam::',
                    {
                      Ref: 'AWS::AccountId',
                    },
                    ':root',
                  ],
                ],
              },
            },
            Resource: '*',
          },
        ],
      },
      SecretId: {
        Ref: 'DashboardDatabaseSecretAttachmentB749CF34',
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Serverless::Application', {
      Location: {
        ApplicationId: {
          'Fn::FindInMap': [
            'DashboardDatabaseRotationSingleUserSARMappingFAC79544',
            {
              Ref: 'AWS::Partition',
            },
            'applicationId',
          ],
        },
        SemanticVersion: {
          'Fn::FindInMap': [
            'DashboardDatabaseRotationSingleUserSARMappingFAC79544',
            {
              Ref: 'AWS::Partition',
            },
            'semanticVersion',
          ],
        },
      },
      Parameters: {
        endpoint: {
          'Fn::Join': [
            '',
            [
              'https://secretsmanager.',
              {
                Ref: 'AWS::Region',
              },
              '.',
              {
                Ref: 'AWS::URLSuffix',
              },
            ],
          ],
        },
      },
    });
  });

  test('rotating password of DocDB is supported since v1.109.0 when deploying to China regions', () => {
    const context = deployToCNRegion();

    Template.fromStack(context.stack).resourceCountIs('AWS::SecretsManager::RotationSchedule', 1);

    Template.fromStack(context.stack).resourceCountIs('AWS::SecretsManager::ResourcePolicy', 1);

    Template.fromStack(context.stack).resourceCountIs('AWS::Serverless::Application', 1);
  });

  test('layer for docdb cert is created', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::LayerVersion', {
      Description: '/RDS CAs',
    });
  });

  test('custom resource for creating indexes of docdb', () => {
    Template.fromStack(stack).hasResource('Custom::DocDB-CreateIndexes', {
      Properties: {
        ServiceToken: {
          'Fn::GetAtt': [
            'DocDBCustomResourceProviderframeworkonEvent30301157',
            'Arn',
          ],
        },
        Database: 'fraud-detection',
        Collection: 'transaction',
        Indexes: [
          {
            key: {
              isFraud: 1,
              timestamp: -1,
            },
          },
        ],
      },
      DependsOn: [
        'DashboardDatabaseInstance186709BD9',
        'DashboardDatabaseF93C7646',
        'DashboardDatabaseRotationSingleUser0EB18E12',
        'DashboardDatabaseRotationSingleUserSecurityGroupDCFB3DB6',
        'DashboardDatabaseSecretAttachmentPolicyEDCE0207',
        'DashboardDatabaseSecretAttachmentB749CF34',
        'DashboardDatabaseSecretAttachmentRotationScheduleD0CB8A1A',
        'DashboardDatabaseSecretCF9F4299',
        'DashboardDatabaseSubnetsD80E6AA1',
      ],
    });
  });

  test('dashboard graphql is created', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'appsync.amazonaws.com',
            },
          },
        ],
      },
      Policies: [
        {
          PolicyDocument: {
            Statement: [
              {
                Action: [
                  'logs:CreateLogGroup',
                  'logs:CreateLogStream',
                  'logs:PutLogEvents',
                ],
                Effect: 'Allow',
                Resource: '*',
              },
            ],
          },
        },
      ],
    });

    Template.fromStack(stack).hasResourceProperties('AWS::AppSync::GraphQLApi', {
      AuthenticationType: 'AWS_IAM',
      LogConfig: {
        CloudWatchLogsRoleArn: {
          'Fn::GetAtt': [
            'CloudWatchLogRoleE3242F1C',
            'Arn',
          ],
        },
        FieldLogLevel: 'ALL',
      },
      XrayEnabled: true,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::AppSync::GraphQLSchema', {
      ApiId: {
        'Fn::GetAtt': [
          'FraudDetectionDashboardAPID13F00C7',
          'ApiId',
        ],
      },
      Definition: 'type Transaction @aws_iam @aws_api_key {\n  id: String!\n  amount: Float!\n  timestamp: AWSTimestamp!\n  productCD: String\n  card1: String\n  card2: String\n  card3: String\n  card4: String\n  card5: String\n  card6: String\n  addr1: String\n  addr2: String\n  dist1: String\n  dist2: String\n  pEmaildomain: String\n  rEmaildomain: String\n  isFraud: Boolean!\n}\n\ntype TransactionStats @aws_iam @aws_api_key {\n  totalCount: Int!\n  totalAmount: Float!\n  fraudCount: Int!\n  totalFraudAmount: Float!\n}\n\ntype Query @aws_iam @aws_api_key {\n  getTransactionStats(start: Int, end: Int): TransactionStats\n  getFraudTransactions(start: Int, end: Int): [ Transaction ]\n}',
    });

    Template.fromStack(stack).hasResourceProperties('AWS::AppSync::DataSource', {
      ApiId: {
        'Fn::GetAtt': [
          'FraudDetectionDashboardAPID13F00C7',
          'ApiId',
        ],
      },
      Name: 'TransactionSource',
      Type: 'AWS_LAMBDA',
      LambdaConfig: {
        LambdaFunctionArn: {
          'Fn::GetAtt': [
            'TransacationFunc54612B5F',
            'Arn',
          ],
        },
      },
      ServiceRoleArn: {
        'Fn::GetAtt': [
          'FraudDetectionDashboardAPITransactionSourceServiceRole03443E92',
          'Arn',
        ],
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::AppSync::Resolver', {
      ApiId: {
        'Fn::GetAtt': [
          'FraudDetectionDashboardAPID13F00C7',
          'ApiId',
        ],
      },
      FieldName: 'getTransactionStats',
      TypeName: 'Query',
      DataSourceName: 'TransactionSource',
      Kind: 'UNIT',
      RequestMappingTemplate: '{"version": "2017-02-28", "operation": "Invoke", "payload": \n        {\n          "field": "getStats",\n          "data":  {\n            "start": $context.arguments.start,\n            "end": $context.arguments.end\n          }\n        }\n      }',
      ResponseMappingTemplate: '$util.toJson($ctx.result)',
    });

    Template.fromStack(stack).hasResourceProperties('AWS::AppSync::Resolver', {
      ApiId: {
        'Fn::GetAtt': [
          'FraudDetectionDashboardAPID13F00C7',
          'ApiId',
        ],
      },
      FieldName: 'getFraudTransactions',
      TypeName: 'Query',
      DataSourceName: 'TransactionSource',
      Kind: 'UNIT',
      RequestMappingTemplate: '{"version": "2017-02-28", "operation": "Invoke", "payload": \n        {\n          "field": "getFraudTransactions",\n          "data":  {\n            "start": $context.arguments.start,\n            "end": $context.arguments.end\n          }\n        }\n      }',
      ResponseMappingTemplate: '$util.toJson($ctx.result)',
    });
  });

  test('no ApiKey of dashboard graphql is created', () => {
    Template.fromStack(stack).resourceCountIs('AWS::AppSync::ApiKey', 0);
  });

  test('transaction generator is created', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          INFERENCE_ARN: 'arn:aws:lambda:ap-southeast-1:123456789012:function:inference-func',
          DATASET_URL: {
            'Fn::FindInMap': [
              'DataSet',
              {
                Ref: 'AWS::Partition',
              },
              'ieee',
            ],
          },
        },
      },
      Handler: 'gen.handler',
      Layers: [
        {
          Ref: 'AwsDataWranglerLayer73D7C4F6',
        },
      ],
      MemorySize: 3008,
      Runtime: 'python3.9',
      Timeout: 900,
      TracingConfig: {
        Mode: 'Active',
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
      DefinitionString: {
        'Fn::Join': [
          '',
          [
            '{"StartAt":"Simulation prepare","States":{"Simulation prepare":{"Next":"Concurrent simulation","Retry":[{"ErrorEquals":["Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Type":"Task","Resource":"arn:',
            {
              Ref: 'AWS::Partition',
            },
            ':states:::lambda:invoke","Parameters":{"FunctionName":"',
            {
              'Fn::GetAtt': [
                'ParametersFuncDFE97108',
                'Arn',
              ],
            },
            '","Payload.$":"$"},"ResultSelector":{"parameters.$":"$.Payload"}},"Concurrent simulation":{"Type":"Map","End":true,"InputPath":"$.parameters","Iterator":{"StartAt":"Generate live transactions","States":{"Generate live transactions":{"End":true,"Retry":[{"ErrorEquals":["Lambda.ServiceException","Lambda.AWSLambdaException","Lambda.SdkClientException"],"IntervalSeconds":2,"MaxAttempts":6,"BackoffRate":2}],"Catch":[{"ErrorEquals":["States.Timeout"],"ResultPath":null,"Next":"Stop generation"}],"Type":"Task","TimeoutSecondsPath":"$.duration","Resource":"arn:',
            {
              Ref: 'AWS::Partition',
            },
            ':states:::lambda:invoke","Parameters":{"FunctionName":"',
            {
              'Fn::GetAtt': [
                'TransactionSimulatorFunc26BB1228',
                'Arn',
              ],
            },
            '","Payload.$":"$"}},"Stop generation":{"Type":"Pass","End":true}}},"ItemsPath":"$.iter","MaxConcurrency":0}}}',
          ],
        ],
      },
      TracingConfiguration: {
        Enabled: true,
      },
    });
  });

  // see https://docs.aws.amazon.com/step-functions/latest/dg/bp-cwl.html for detail
  test('log group of states is applied the best practise.', () => {
    Template.fromStack(stack).hasResource('AWS::Logs::LogGroup', {
      Properties: {
        LogGroupName: {
          'Fn::Join': [
            '',
            [
              '/aws/vendedlogs/realtime-fraud-detection-with-gnn-on-dgl/dashboard/simulator/',
              {
                Ref: 'AWS::StackName',
              },
            ],
          ],
        },
        RetentionInDays: 180,
      },
      UpdateReplacePolicy: 'Delete',
      DeletionPolicy: 'Delete',
    });
    Template.fromStack(stack).hasResourceProperties('AWS::StepFunctions::StateMachine', {
      LoggingConfiguration: {
        Destinations: [
          {
            CloudWatchLogsLogGroup: {
              LogGroupArn: {
                'Fn::GetAtt': [
                  'FraudDetectionSimulatorLogGroupDAA20302',
                  'Arn',
                ],
              },
            },
          },
        ],
        IncludeExecutionData: true,
        Level: 'ALL',
      },
    });
  });

  test('fn processes the sqs events', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Role: {
        'Fn::GetAtt': [
          'TransacationEventFuncServiceRoleE7060D37',
          'Arn',
        ],
      },
      Environment: {
        Variables: {
          DB_SECRET_ARN: {
            Ref: 'DashboardDatabaseSecretAttachmentB749CF34',
          },
          DB_DATABASE: 'fraud-detection',
          DB_COLLECTION: 'transaction',
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
          CA_FILE: {
            'Fn::FindInMap': [
              'RDSCA',
              {
                Ref: 'AWS::Partition',
              },
              'CAFile',
            ],
          },
        },
      },
      Handler: 'index.handler',
      Layers: [
        {
          Ref: 'CertLayerDEBF0D9A',
        },
      ],
      MemorySize: 256,
      Runtime: 'nodejs16.x',
      Timeout: 60,
      VpcConfig: {
        SecurityGroupIds: [
          {
            'Fn::GetAtt': [
              'DashboardToDocDBSGD91501D9',
              'GroupId',
            ],
          },
        ],
        SubnetIds: [
          {
            Ref: 'referencetoTestStackVpcPrivateSubnet1Subnet707BB947Ref',
          },
          {
            Ref: 'referencetoTestStackVpcPrivateSubnet2Subnet5DE74951Ref',
          },
        ],
      },
      TracingConfig: {
        Mode: 'Active',
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionName: {
        Ref: 'TransacationEventFuncE6A7AC47',
      },
      BatchSize: 10,
      Enabled: true,
      EventSourceArn: {
        Ref: 'referencetoTestStackTransQueue6E481EC7Arn',
      },
    });
  });

  test('http api for dashboard', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
    });

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: 'api',
      AccessLogSettings: {
        DestinationArn: {
          'Fn::GetAtt': [
            'StageapiLog3FA18EF0',
            'Arn',
          ],
        },
        Format: '{"requestId":"$context.requestId","ip":"$context.identity.sourceIp","caller":"$context.identity.caller","user":"$context.identity.user","requestTime":"$context.requestTime","httpMethod":"$context.httpMethod","resourcePath":"$context.resourcePath","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength"}',
      },
      AutoDeploy: true,
    });

    Template.fromStack(stack).resourceCountIs('AWS::ApiGatewayV2::Stage', 1);

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      ConnectionType: 'INTERNET',
      CredentialsArn: {
        'Fn::GetAtt': [
          'FraudDetectionDashboardApiRole4337F0C9',
          'Arn',
        ],
      },
      IntegrationSubtype: 'StepFunctions-StartExecution',
      PayloadFormatVersion: '1.0',
      RequestParameters: {
        StateMachineArn: {
          Ref: 'TransactionGenerator2F77AC65',
        },
        Input: '$request.body.input',
      },
      TimeoutInMillis: 10000,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /start',
      AuthorizationType: 'NONE',
      Target: {
        'Fn::Join': [
          '',
          [
            'integrations/',
            {
              Ref: 'GeneratorStartIntegration',
            },
          ],
        ],
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 'states:StartExecution',
            Effect: 'Allow',
            Resource: {
              Ref: 'TransactionGenerator2F77AC65',
            },
          },
        ],
      },
    });
  });

  test('http api for getting token of appsync', () => {
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      ApiId: {
        Ref: 'FraudDetectionDashboardApiE395505A',
      },
      IntegrationType: 'AWS_PROXY',
      IntegrationUri: {
        'Fn::GetAtt': [
          'DashboardGraphqlToken4C5EDC8B',
          'Arn',
        ],
      },
      PayloadFormatVersion: '2.0',
    });

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Route', {
      ApiId: {
        Ref: 'FraudDetectionDashboardApiE395505A',
      },
      RouteKey: 'GET /token',
    });

    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      ApiId: {
        Ref: 'FraudDetectionDashboardApiE395505A',
      },
      StageName: 'api',
      AutoDeploy: true,
    });
  });

  test('dashboard stack output', () => {
    const template = Template.fromStack(stack);
    template.hasOutput('DashboardDBEndpoint', {
    });

    template.hasOutput('DashboardGrapqlEndpoint', {
    });

    template.hasOutput('DashboardWebsiteUrl', {
    });
  });

  test('distributed dashboard website by s3 and cloudfront in standarnd partition', () => {
    Template.fromStack(stack).hasResource('AWS::S3::Bucket', {
      Properties: {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
        LoggingConfiguration: {
          DestinationBucketName: {
            Ref: 'referencetoTestStackAccessLogF5229892Ref',
          },
          LogFilePrefix: 'dashboardUIBucketAccessLog',
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      },
      UpdateReplacePolicy: 'Delete',
      DeletionPolicy: 'Delete',
    });

    Template.fromStack(stack).hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action: [
              's3:GetBucket*',
              's3:List*',
              's3:DeleteObject*',
            ],
            Effect: 'Allow',
            Principal: {
              AWS: {
                'Fn::GetAtt': [
                  'CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092',
                  'Arn',
                ],
              },
            },
            Resource: [
              {
                'Fn::GetAtt': [
                  'DashboardUI1FD1D9B2',
                  'Arn',
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    {
                      'Fn::GetAtt': [
                        'DashboardUI1FD1D9B2',
                        'Arn',
                      ],
                    },
                    '/*',
                  ],
                ],
              },
            ],
          },
          {
            Action: 's3:GetObject',
            Effect: 'Allow',
            Principal: {
              CanonicalUser: {
                'Fn::GetAtt': [
                  'DistributionOrigin1S3Origin5F5C0696',
                  'S3CanonicalUserId',
                ],
              },
            },
            Resource: {
              'Fn::Join': [
                '',
                [
                  {
                    'Fn::GetAtt': [
                      'DashboardUI1FD1D9B2',
                      'Arn',
                    ],
                  },
                  '/*',
                ],
              ],
            },
          },
        ],
      },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: {
        DefaultTTL: 604800,
        MaxTTL: 2592000,
        MinTTL: 0,
        Name: {
          'Fn::Join': [
            '',
            [
              'cachepolicy-',
              {
                Ref: 'AWS::StackName',
              },
            ],
          ],
        },
        ParametersInCacheKeyAndForwardedToOrigin: {
          CookiesConfig: {
            CookieBehavior: 'none',
          },
          EnableAcceptEncodingBrotli: true,
          EnableAcceptEncodingGzip: true,
          HeadersConfig: {
            HeaderBehavior: 'none',
          },
          QueryStringsConfig: {
            QueryStringBehavior: 'none',
          },
        },
      },
    });

    // deploy sar application as lambda@edge
    Template.fromStack(stack).hasResourceProperties('AWS::CloudFormation::CustomResource', {
      ServiceToken: {
        'Fn::GetAtt': [
          'AddSecurityHeaderTransacationFunc920B9BE4',
          'Arn',
        ],
      },
      APPLICATION: 'arn:aws:serverlessrepo:us-east-1:418289889111:applications/add-security-headers',
      SEMATIC_VERSION: '1.0.6',
      REGION: 'us-east-1',
      OUTPUT_ATT: 'AddSecurityHeaderFunction',
      NAME: 'AddSecurityHeader',
      Parameters: [
        {
          Name: 'SecPolicy',
          Value: {
            'Fn::Join': [
              '',
              [
                "default-src \\'none\\'; base-uri \\'self\\'; img-src \\'self\\'; script-src \\'self\\'; style-src \\'self\\' \\'unsafe-inline\\' https:; object-src \\'none\\'; frame-ancestors \\'none\\'; font-src \\'self\\' https:; form-action \\'self\\'; manifest-src \\'self\\'; connect-src \\'self\\' https://",
                {
                  'Fn::Select': [
                    2,
                    {
                      'Fn::Split': [
                        '/',
                        {
                          'Fn::GetAtt': [
                            'FraudDetectionDashboardAPID13F00C7',
                            'GraphQLUrl',
                          ],
                        },
                      ],
                    },
                  ],
                },
                '/',
              ],
            ],
          },
        },
      ],
    });

    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        CacheBehaviors: [
          {
            AllowedMethods: [
              'GET',
              'HEAD',
              'OPTIONS',
              'PUT',
              'PATCH',
              'POST',
              'DELETE',
            ],
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
            Compress: true,
            PathPattern: '/api/*',
            TargetOriginId: 'TestStackDashboardStackDistributionOrigin2073DB050',
            ViewerProtocolPolicy: 'redirect-to-https',
          },
        ],
        DefaultCacheBehavior: {
          AllowedMethods: [
            'GET',
            'HEAD',
          ],
          CachePolicyId: {
            Ref: 'defaultCachePolicy2969DB4C',
          },
          Compress: true,
          TargetOriginId: 'TestStackDashboardStackDistributionOrigin1D3E29DD1',
          ViewerProtocolPolicy: 'redirect-to-https',
          LambdaFunctionAssociations: [
            {
              EventType: 'origin-response',
              LambdaFunctionARN: {
                'Fn::GetAtt': [
                  'AddSecurityHeaderSarDeploymentResourceAddSecurityHeader9B1FFD83',
                  'FuncVersionArn',
                ],
              },
            },
          ],
        },
        DefaultRootObject: 'index.html',
        Enabled: true,
        HttpVersion: 'http2',
        IPV6Enabled: true,
        PriceClass: 'PriceClass_All',
        Logging: {
          Bucket: {
            Ref: 'referencetoTestStackAccessLogF5229892RegionalDomainName',
          },
          Prefix: 'cfAccessLog',
        },
        CustomErrorResponses: [
          {
            ErrorCachingMinTTL: 30,
            ErrorCode: 500,
          },
          {
            ErrorCachingMinTTL: 0,
            ErrorCode: 502,
          },
          {
            ErrorCachingMinTTL: 0,
            ErrorCode: 503,
          },
        ],
        Origins: [
          {
            DomainName: {
              'Fn::GetAtt': [
                'DashboardUI1FD1D9B2',
                'RegionalDomainName',
              ],
            },
            Id: 'TestStackDashboardStackDistributionOrigin1D3E29DD1',
            S3OriginConfig: {
              OriginAccessIdentity: {
                'Fn::Join': [
                  '',
                  [
                    'origin-access-identity/cloudfront/',
                    {
                      Ref: 'DistributionOrigin1S3Origin5F5C0696',
                    },
                  ],
                ],
              },
            },
          },
          {
            CustomOriginConfig: {
              OriginProtocolPolicy: 'https-only',
              OriginSSLProtocols: [
                'TLSv1.2',
              ],
            },
            DomainName: {
              'Fn::Select': [
                2,
                {
                  'Fn::Split': [
                    '/',
                    {
                      'Fn::GetAtt': [
                        'FraudDetectionDashboardApiE395505A',
                        'ApiEndpoint',
                      ],
                    },
                  ],
                },
              ],
            },
            Id: 'TestStackDashboardStackDistributionOrigin2073DB050',
          },
        ],
      },
    });

    Template.fromStack(stack).hasResourceProperties('Custom::AWS', {
      Create: {
        'Fn::Join': [
          '',
          [
            '{"service":"S3","action":"putObject","parameters":{"Body":"{\\n            \\"api_path\\": \\"/api\\",\\n            \\"aws_project_region\\": \\"',
            {
              Ref: 'AWS::Region',
            },
            '\\",\\n            \\"aws_appsync_graphqlEndpoint\\": \\"',
            {
              'Fn::GetAtt': [
                'FraudDetectionDashboardAPID13F00C7',
                'GraphQLUrl',
              ],
            },
            '\\",\\n            \\"aws_appsync_region\\": \\"',
            {
              Ref: 'AWS::Region',
            },
            '\\",\\n            \\"aws_appsync_authenticationType\\": \\"AWS_IAM\\",\\n            \\"aws_appsync_apiKey\\": \\"undefined\\"\\n          }","Bucket":"',
            {
              Ref: 'DashboardUI1FD1D9B2',
            },
            '","Key":"aws-exports.json"},"physicalResourceId":{"responsePath":"ETag"}}',
          ],
        ],
      },
      Update: {
        'Fn::Join': [
          '',
          [
            '{"service":"S3","action":"putObject","parameters":{"Body":"{\\n            \\"api_path\\": \\"/api\\",\\n            \\"aws_project_region\\": \\"',
            {
              Ref: 'AWS::Region',
            },
            '\\",\\n            \\"aws_appsync_graphqlEndpoint\\": \\"',
            {
              'Fn::GetAtt': [
                'FraudDetectionDashboardAPID13F00C7',
                'GraphQLUrl',
              ],
            },
            '\\",\\n            \\"aws_appsync_region\\": \\"',
            {
              Ref: 'AWS::Region',
            },
            '\\",\\n            \\"aws_appsync_authenticationType\\": \\"AWS_IAM\\",\\n            \\"aws_appsync_apiKey\\": \\"undefined\\"\\n          }","Bucket":"',
            {
              Ref: 'DashboardUI1FD1D9B2',
            },
            '","Key":"aws-exports.json"},"physicalResourceId":{"responsePath":"ETag"}}',
          ],
        ],
      },
      InstallLatestAwsSdk: false,
    });

    Template.fromStack(stack).hasResource('Custom::CDKBucketDeployment', {
      Properties: {
        DestinationBucketName: {
          Ref: 'DashboardUI1FD1D9B2',
        },
        DestinationBucketKeyPrefix: '/',
        RetainOnDelete: false,
        Prune: false,
        SystemMetadata: {
          'cache-control': 'max-age=604800',
          'storage-class': 'INTELLIGENT_TIERING',
        },
        DistributionId: {
          Ref: 'Distribution830FAC52',
        },
        DistributionPaths: [
          '/index.html',
          '/locales/*',
          '/aws-exports.json',
        ],
      },
      DependsOn: [
        'CreateAwsExportsCustomResourcePolicyE986A674',
        'CreateAwsExports353D691F',
      ],
    });
  });

  test('cloudfront with custom domain in standarnd partition', () => {
    const app = new App({});
    const parentStack = new Stack(app, 'TestStack');
    const dashboardDomainNamePara = new CfnParameter(parentStack, 'DashboardDomain', {
      type: 'String',
    });
    const r53HostZoneIdPara = new CfnParameter(parentStack, 'Route53HostedZoneId', {
      type: 'AWS::Route53::HostedZone::Id',
    });

    ({ stack } = initializeStackWithContextsAndEnvs({}, undefined, parentStack,
      dashboardDomainNamePara.valueAsString, r53HostZoneIdPara.valueAsString));

    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        ViewerCertificate: {
          AcmCertificateArn: {
            'Fn::GetAtt': [
              'CustomDomainCertificateForCloudFrontCertificateRequestorResource54BD7C29',
              'Arn',
            ],
          },
          MinimumProtocolVersion: 'TLSv1.2_2019',
          SslSupportMethod: 'sni-only',
        },
      },
    });

    //TODO: Stack.resolve does not work if there is no a precede expection!!!
    Template.fromStack(stack).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Aliases: [
          stack.resolve(dashboardDomainNamePara.valueAsString),
        ],

      },
    });
  });

  test('distributed dashboard website by s3 and cloudfront in aws-cn regions', () => {
    const context = deployToCNRegion();

    Template.fromStack(context.stack).hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action: [
              's3:GetBucket*',
              's3:List*',
              's3:DeleteObject*',
            ],
            Effect: 'Allow',
            Principal: {
              AWS: {
                'Fn::GetAtt': [
                  'CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092',
                  'Arn',
                ],
              },
            },
            Resource: [
              {
                'Fn::GetAtt': [
                  'DashboardUI1FD1D9B2',
                  'Arn',
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    {
                      'Fn::GetAtt': [
                        'DashboardUI1FD1D9B2',
                        'Arn',
                      ],
                    },
                    '/*',
                  ],
                ],
              },
            ],
          },
          {
            Action: 's3:GetObject',
            Effect: 'Allow',
            Principal: {
              CanonicalUser: {
                'Fn::GetAtt': [
                  'DashboardWebsiteOAIB75F781F',
                  'S3CanonicalUserId',
                ],
              },
            },
            Resource: {
              'Fn::Join': [
                '',
                [
                  {
                    'Fn::GetAtt': [
                      'DashboardUI1FD1D9B2',
                      'Arn',
                    ],
                  },
                  '/*',
                ],
              ],
            },
          },
        ],
      },
    });

    Template.fromStack(context.stack).hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        Aliases: [
          context.stack.resolve(context.dashboardDomainNamePara.valueAsString),
        ],
        ViewerCertificate: {
          CloudFrontDefaultCertificate: true,
        },
        CacheBehaviors: [
          {
            AllowedMethods: [
              'DELETE',
              'GET',
              'HEAD',
              'OPTIONS',
              'PATCH',
              'POST',
              'PUT',
            ],
            Compress: true,
            DefaultTTL: 0,
            ForwardedValues: {
              QueryString: false,
            },
            MaxTTL: 0,
            PathPattern: '/api/*',
            TargetOriginId: 'origin2',
            ViewerProtocolPolicy: 'allow-all',
          },
        ],
        DefaultCacheBehavior: {
          AllowedMethods: [
            'GET',
            'HEAD',
          ],
          Compress: true,
          DefaultTTL: 604800,
          ForwardedValues: {
            QueryString: false,
          },
          MaxTTL: 2592000,
          TargetOriginId: 'origin1',
          ViewerProtocolPolicy: 'allow-all',
        },
        DefaultRootObject: 'index.html',
        Enabled: true,
        HttpVersion: 'http2',
        IPV6Enabled: false,
        PriceClass: 'PriceClass_All',
        Logging: {
          Bucket: {
            Ref: 'referencetoTestStackAccessLogF5229892RegionalDomainName',
          },
          Prefix: 'cfAccessLog',
        },
        CustomErrorResponses: [
          {
            ErrorCachingMinTTL: 30,
            ErrorCode: 500,
          },
          {
            ErrorCachingMinTTL: 0,
            ErrorCode: 502,
          },
          {
            ErrorCachingMinTTL: 0,
            ErrorCode: 503,
          },
        ],
        Origins: [
          {
            DomainName: {
              'Fn::GetAtt': [
                'DashboardUI1FD1D9B2',
                'RegionalDomainName',
              ],
            },
            Id: 'origin1',
            S3OriginConfig: {
              OriginAccessIdentity: {
                'Fn::Join': [
                  '',
                  [
                    'origin-access-identity/cloudfront/',
                    {
                      Ref: 'DashboardWebsiteOAIB75F781F',
                    },
                  ],
                ],
              },
            },
          },
          {
            CustomOriginConfig: {
              OriginProtocolPolicy: 'https-only',
              OriginSSLProtocols: [
                'TLSv1.2',
              ],
            },
            DomainName: {
              'Fn::Select': [
                2,
                {
                  'Fn::Split': [
                    '/',
                    {
                      'Fn::GetAtt': [
                        'FraudDetectionDashboardApiE395505A',
                        'ApiEndpoint',
                      ],
                    },
                  ],
                },
              ],
            },
            Id: 'origin2',
          },
        ],
      },
    });

    Template.fromStack(context.stack).hasResourceProperties('AWS::Route53::RecordSet', {
      Name: {
        'Fn::Join': [
          '',
          [
            context.stack.resolve(context.dashboardDomainNamePara.valueAsString),
            '.',
          ],
        ],
      },
      Type: 'A',
      AliasTarget: {
        DNSName: {
          'Fn::GetAtt': [
            'DashboardDistributionCFDistributionEFC4B3CE',
            'DomainName',
          ],
        },
        HostedZoneId: {
          'Fn::FindInMap': [
            'AWSCloudFrontPartitionHostedZoneIdMap',
            {
              Ref: 'AWS::Partition',
            },
            'zoneId',
          ],
        },
      },
      HostedZoneId: context.stack.resolve(context.r53HostZoneIdPara),
    });

  });
});

function deployToCNRegion(): {
  stack: Stack;
  dashboardDomainNamePara: CfnParameter;
  r53HostZoneIdPara: CfnParameter;
} {
  const app = new App({
    context: {
      TargetPartition: 'aws-cn',
    },
  });
  const parentStack = new Stack(app, 'TestStack');
  const dashboardDomainNamePara = new CfnParameter(parentStack, 'DashboardDomain', {
    type: 'String',
  });
  const r53HostZoneIdPara = new CfnParameter(parentStack, 'Route53HostedZoneId', {
    type: 'AWS::Route53::HostedZone::Id',
  });

  return {
    ...initializeStackWithContextsAndEnvs({
      TargetPartition: 'aws-cn',
    }, undefined, parentStack, dashboardDomainNamePara.valueAsString, r53HostZoneIdPara.valueAsString),
    dashboardDomainNamePara,
    r53HostZoneIdPara,
  };
}

function initializeStackWithContextsAndEnvs(context: {} | undefined, env?: {} | undefined,
  _parentStack?: Stack, customDomain?: string, r53HostZoneId?: string) {
  const app = new App({
    context,
  });
  const parentStack = _parentStack ?? new Stack(app, 'TestStack', { env: env });
  const vpc = new Vpc(parentStack, 'Vpc');
  const queue = new Queue(parentStack, 'TransQueue', {
    contentBasedDeduplication: true,
    encryption: QueueEncryption.KMS_MANAGED,
    fifo: true,
    removalPolicy: RemovalPolicy.DESTROY,
    visibilityTimeout: Duration.seconds(60),
  });
  const inferenceArn = 'arn:aws:lambda:ap-southeast-1:123456789012:function:inference-func';
  const accessLogBucket = new Bucket(parentStack, 'AccessLog');

  const stack = new TransactionDashboardStack(parentStack, 'DashboardStack', {
    vpc,
    queue,
    inferenceArn,
    accessLogBucket,
    customDomain,
    r53HostZoneId,
  });
  return { stack };
}
