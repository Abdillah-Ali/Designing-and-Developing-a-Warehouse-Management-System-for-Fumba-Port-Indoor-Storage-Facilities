const buildError = (message, statusCode = 400, errors) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errors = errors;
  return error;
};

module.exports = {
  buildError
};
