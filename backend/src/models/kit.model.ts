import { Schema, model, type InferSchemaType } from "mongoose";
import type { AppendixAKit, ItemStates } from "@prep-assist/shared";

const kitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    fingerprint: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["draft", "generating", "ready", "failed"],
      required: true,
      default: "draft",
    },
    kit: { type: Schema.Types.Mixed, required: true },
    itemStates: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

kitSchema.index({ userId: 1, fingerprint: 1 }, { unique: true });

export type KitDocument = InferSchemaType<typeof kitSchema> & {
  kit: AppendixAKit;
  itemStates: ItemStates;
};

export const KitModel = model("Kit", kitSchema);