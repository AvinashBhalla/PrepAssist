import { z } from "zod";

export type ApiResponse<T> = {
  ok: boolean;
  service?: string;
  data?: T;
  error?: string;
};

export type User = {
  id: string;
  email: string;
};

export type Kit = {
  id: string;
  title: string;
};

export const userSchema = z.object({
  id: z.string(),
  email: z.email(),
});

export const kitSchema = z.object({
  id: z.string(),
  title: z.string(),
});