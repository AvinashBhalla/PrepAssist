import type { RequestHandler } from "express";
import type { ApiResponse } from "@prep-assist/shared";

export const getHealth: RequestHandler = (_request, response) => {
  const payload: ApiResponse<{ service: string }> = {
    ok: true,
    service: "PrepAssist",
  };

  response.json(payload);
};