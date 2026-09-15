import type { NextFunction, Request, Response } from "express";
import { getStudent, verifyToken } from "../lib/asr-store";

export type AuthenticatedRequest = Request & { studentId?: string };

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const studentId = verifyToken(token);
  if (!studentId || !getStudent(studentId)) {
    res.status(401).json({ error: "Please log in to continue." });
    return;
  }
  req.studentId = studentId;
  next();
}