const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const exposeDetails = process.env.NODE_ENV !== "production" && statusCode < 500;

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? "Internal server error" : (err.message || "Request failed"),
    errors: exposeDetails ? err.errors || undefined : undefined,
    details: exposeDetails ? err.details || undefined : undefined
  });
};

module.exports = {
  notFoundHandler,
  errorHandler
};
