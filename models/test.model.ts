import mongoose, { Document, Model, Schema } from "mongoose";

export interface IQuestion extends Document {
  title: string;
  options: string[];
  answer: string;
  difficulty: "easy" | "medium" | "hard";
}

export interface ITest extends Document {
  courseId: mongoose.Schema.Types.ObjectId;
  questions: IQuestion[];
}

const questionSchema = new Schema<IQuestion>({
  title: {
    type: String,
    required: true,
  },
  options: {
    type: [String],
    required: true,
    validate: [
      (val: string[]) => val.length === 4,
      "A question must have exactly 4 options",
    ],
  },
  answer: {
    type: String,
    required: true,
  },
  difficulty: {
    type: String,
    enum: ["easy", "medium", "hard"],
    required: true,
  },
});

const testSchema = new Schema<ITest>(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    questions: [questionSchema],
  },
  { timestamps: true }
);

const TestModel: Model<ITest> = mongoose.model("Test", testSchema);

export default TestModel;
