import { Schema, model, type InferSchemaType } from "mongoose";

const practiceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    kitId: { type: Schema.Types.ObjectId, required: true, index: true },
    flashcardId: { type: String, required: true },
    confidence: { type: Number, required: true, enum: [1, 2, 3] },
    lastReviewed: { type: Date, required: true },
    reviewCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

practiceSchema.index({ userId: 1, kitId: 1, flashcardId: 1 }, { unique: true });

export type PracticeDocument = InferSchemaType<typeof practiceSchema>;

export const PracticeModel = model("Practice", practiceSchema);
