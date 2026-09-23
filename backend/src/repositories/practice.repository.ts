import type { Types } from "mongoose";
import { PracticeModel, type PracticeDocument } from "../models/practice.model.js";

export type UpsertPracticeInput = {
  userId: Types.ObjectId;
  kitId: Types.ObjectId;
  flashcardId: string;
  confidence: 1 | 2 | 3;
};

export const practiceRepository = {
  async upsert(input: UpsertPracticeInput): Promise<PracticeDocument> {
    const update = {
      $set: {
        confidence: input.confidence,
        lastReviewed: new Date(),
      },
      $inc: { reviewCount: 1 },
    };

    return PracticeModel.findOneAndUpdate(
      { userId: input.userId, kitId: input.kitId, flashcardId: input.flashcardId },
      update,
      { new: true, upsert: true }
    ).exec() as Promise<PracticeDocument>;
  },

  async findByKit(userId: Types.ObjectId, kitId: Types.ObjectId): Promise<PracticeDocument[]> {
    return PracticeModel.find({ userId, kitId }).exec() as Promise<PracticeDocument[]>;
  }
};
