import { UserModel } from "../models/user.model.js";

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
};

export type CreateUserInput = {
  email: string;
  passwordHash: string;
};

export type UserRepository = {
  create(input: CreateUserInput): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
};

function toUserRecord(user: {
  _id: { toString(): string };
  email: string;
  passwordHash: string;
}): UserRecord {
  return {
    id: user._id.toString(),
    email: user.email,
    passwordHash: user.passwordHash,
  };
}

export const userRepository = {
  async create(input: CreateUserInput): Promise<UserRecord> {
    const user = await UserModel.create({
      email: input.email.toLowerCase().trim(),
      passwordHash: input.passwordHash,
    });
    return toUserRecord(user);
  },

  async findByEmail(email: string): Promise<UserRecord | null> {
    const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).exec();
    return user ? toUserRecord(user) : null;
  },

  async findById(id: string): Promise<UserRecord | null> {
    const user = await UserModel.findById(id).exec();
    return user ? toUserRecord(user) : null;
  },
};