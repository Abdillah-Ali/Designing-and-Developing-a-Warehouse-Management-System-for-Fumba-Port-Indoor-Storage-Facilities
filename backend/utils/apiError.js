const buildError = (message, statusCode = 400, errors, errorCode = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  error.errorCode = errorCode;
  return error;
};

module.exports = {
  buildError
};
