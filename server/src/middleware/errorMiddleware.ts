import { Request, Response, NextFunction } from "express";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[ServerError]:", err);
  const status = (err as unknown as { status?: number }).status || 500;
  res.status(status).json({
    error: err.message || "Internal server error",
  });
}
