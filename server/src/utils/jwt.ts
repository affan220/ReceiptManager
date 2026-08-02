import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "masjid_secret_jwt_key_2026_super_secure";
const JWT_EXPIRES_IN = "7d";

export interface TokenPayload {
  id: number;
  username: string;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
