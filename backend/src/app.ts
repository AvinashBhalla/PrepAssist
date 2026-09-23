import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { AuthError } from "./services/auth.service.js";
import { userRepository, type UserRepository } from "./repositories/user.repository.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { createKitRouter } from "./routes/kit.routes.js";

export function createApp(repository: UserRepository = userRepository) {
	const app = express();

	app.disable("x-powered-by");
	app.use(helmet());
	app.use(
		cors({
			origin: process.env.FRONTEND_URL ?? "http://localhost:3000",
			credentials: true,
		}),
	);
	app.use(express.json({ limit: "100kb" }));
	app.use(cookieParser());
	app.use("/api/health", healthRouter);
	app.use("/api/auth", createAuthRouter(repository));
	app.use("/api/kits", createKitRouter());
	app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
		if (error instanceof AuthError) {
			response.status(error.status).json({
				ok: false,
				error: { code: error.code, message: error.message },
			});
			return;
		}

		response.status(500).json({
			ok: false,
			error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." },
		});
	});

	return app;
}

export const app = createApp();