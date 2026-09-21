import cors from "cors";
import express from "express";
import helmet from "helmet";
import { healthRouter } from "./routes/health.routes.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:3000" }));
app.use(express.json({ limit: "100kb" }));
app.use("/api/health", healthRouter);