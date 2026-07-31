import { timingSafeEqual } from "node:crypto";

export const isAuthorizedInternalRequest = (request: Request): boolean => {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (!secret || !authorization) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);

  return (
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
};
