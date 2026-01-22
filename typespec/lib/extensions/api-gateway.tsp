model AmazonApiGatewayIntegration {
  type: "aws_proxy";
  httpMethod: "POST";
  passthroughBehavior: "when_no_match";
  uri: {
    `Fn::Sub`: "arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:\${AWS::Region}:\${AWS::AccountId}:function:{{HandlerFunctionName}}/invocations";
  };
}

const APIGatewayIntegration = #{
  type: "aws_proxy",
  httpMethod: "POST",
  passthroughBehavior: "when_no_match",
  uri: #{
    `Fn::Sub`: "arn:aws:apigateway:\${AWS::Region}:lambda:path/2015-03-31/functions/arn:aws:lambda:\${AWS::Region}:\${AWS::AccountId}:function:{{HandlerFunctionName}}/invocations",
  },
};
