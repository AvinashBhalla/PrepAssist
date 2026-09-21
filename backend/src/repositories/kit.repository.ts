import type { AppendixAKit, ItemStates } from "@prep-assist/shared";
import type { Types } from "mongoose";
import { KitModel, type KitDocument } from "../models/kit.model.js";

export type KitStatus = "draft" | "generating" | "ready" | "failed";

export type CreateKitInput = {
  userId: Types.ObjectId;
  fingerprint: string;
  status?: KitStatus;
  kit: AppendixAKit;
  itemStates: ItemStates;
};

export const kitRepository = {
  async create(input: CreateKitInput): Promise<KitDocument> {
    return KitModel.create(input) as Promise<KitDocument>;
  },

  async findByIdForUser(
    kitId: string,
    userId: Types.ObjectId,
  ): Promise<KitDocument | null> {
    return KitModel.findOne({ _id: kitId, userId }).exec() as Promise<KitDocument | null>;
  },

  async findByUser(userId: Types.ObjectId): Promise<KitDocument[]> {
    return KitModel.find({ userId }).sort({ updatedAt: -1 }).exec() as Promise<KitDocument[]>;
  },

  async updateForUser(
    kitId: string,
    userId: Types.ObjectId,
    update: Partial<Pick<KitDocument, "status" | "kit" | "itemStates" | "fingerprint">>,
  ): Promise<KitDocument | null> {
    return KitModel.findOneAndUpdate({ _id: kitId, userId }, update, {
      new: true,
      runValidators: true,
    }).exec() as Promise<KitDocument | null>;
  },

  async findByFingerprintForUser(
    fingerprint: string,
    userId: Types.ObjectId,
  ): Promise<KitDocument | null> {
    return KitModel.findOne({ fingerprint, userId }).exec() as Promise<KitDocument | null>;
  },
};