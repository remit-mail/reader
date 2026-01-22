import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@extension("x-amazon-apigateway-authtype", "cognito_user_pools")
@extension(
  "x-amazon-apigateway-authorizer",
  #{ type: "cognito_user_pools", providerARNs: #["{{CognitoUserPoolArn}}"] }
)
model CognitoAuthorizer is ApiKeyAuth<ApiKeyLocation.header, "Authorization">;
