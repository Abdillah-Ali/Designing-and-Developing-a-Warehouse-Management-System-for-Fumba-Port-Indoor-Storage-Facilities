const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route not found: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
};

const errorHandler = (err, req, res, next) => {
  // PostgreSQL uses 22003 for numeric range overflow. Present it as a
  // correctable validation issue rather than an opaque server failure.
  const isNumericOverflow = err.code === "22003";
  const statusCode = err.statusCode || (isNumericOverflow ? 400 : 500);
  const exposeDetails = process.env.NODE_ENV !== "production" && statusCode < 500;

  res.status(statusCode).json({
    success: false,
    message: isNumericOverflow
      ? "Capacity is too large. Enter a value no greater than 999,999,999,999,999."
      : statusCode >= 500 ? "Internal server error" : (err.message || "Request failed"),
    errors: exposeDetails ? err.errors || undefined : undefined,
    details: exposeDetails ? err.details || undefined : undefined
  });
};

module.exports = {
  notFoundHandler,
  errorHandler
};
