import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | undefined;

export function getMongoUri(): string {
  const uri = process.env.MONGODB_URI?.trim();

  if (!uri) {
    throw new Error("MONGODB_URI is required to connect to MongoDB");
  }

  return uri;
}

export async function connectToMongoDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(getMongoUri()).catch(() => {
      connectionPromise = undefined;
      throw new Error("MongoDB connection failed");
    });
  }

  return connectionPromise;
}

export async function disconnectFromMongoDB(): Promise<void> {
  connectionPromise = undefined;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}