import type { UserDocument } from "../models/user.model.js";
import { UserModel } from "../models/user.model.js";

export type CreateUserInput = {
  email: string;
  passwordHash: string;
};

export const userRepository = {
  async create(input: CreateUserInput): Promise<UserDocument> {
    return UserModel.create({
      email: input.email.toLowerCase().trim(),
      passwordHash: input.passwordHash,
    });
  },
};