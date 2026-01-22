import "@typespec/http";

using TypeSpec.Http;

@doc("API error response")
model ApiError {
  @doc("Error code")
  code: string;

  @doc("Human-readable error message")
  message: string;

  @doc("Additional error details")
  details?: Record<string>;
}

@doc("Not found error response")
model NotFoundError {
  @statusCode statusCode: 404;
  @body error: ApiError;
}

@doc("Validation error response")
model ValidationError {
  @statusCode statusCode: 400;
  @body error: ApiError;
}

@doc("Internal server error response")
model InternalServerError {
  @statusCode statusCode: 500;
  @body error: ApiError;
}

@doc("Unauthorized error response")
model UnauthorizedError {
  @statusCode statusCode: 401;
  @body error: ApiError;
}

@doc("Forbidden error response")
model ForbiddenError {
  @statusCode statusCode: 403;
  @body error: ApiError;
}
