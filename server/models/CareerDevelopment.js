const mongoose = require("mongoose");

const roadmapItemSchema = new mongoose.Schema({
  skill: { type: String, required: true, trim: true },
  priority: { type: String, enum: ["High", "Medium", "Low"], default: "Medium" },
  reason: { type: String, default: "" },
  estimatedWeeks: { type: Number, default: 2, min: 1, max: 52 },
  status: { type: String, enum: ["Not Started", "In Progress", "Completed"], default: "Not Started" },
  topics: { type: [String], default: [] },
  resource: { title: { type: String, default: "" }, url: { type: String, default: "" } },
  practiceTask: { type: String, default: "" },
  order: { type: Number, default: 0 },
}, { _id: true });

const careerDevelopmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  interests: { type: [String], default: [] },
  selectedRole: { type: String, default: "" },
  roadmap: { type: [roadmapItemSchema], default: [] },
  roadmapUpdatedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model("CareerDevelopment", careerDevelopmentSchema);
