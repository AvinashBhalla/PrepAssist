import { createHash } from "node:crypto";

export function createKitFingerprint(
  jobDescription: string,
  companyUrl: string,
  days: number,
): string {
  const normalizedInput = JSON.stringify({
    jobDescription: jobDescription.trim(),
    companyUrl: companyUrl.trim().toLowerCase(),
    days,
  });

  return createHash("sha256").update(normalizedInput, "utf8").digest("hex");
}