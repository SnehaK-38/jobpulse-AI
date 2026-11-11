const mongoose = require("mongoose");

const roadmapTopicSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  overview: { type: String, default: "" },
  notes: { type: String, default: "" },
  keyPoints: { type: [String], default: [] },
  practiceTask: { type: String, default: "" },
  estimatedHours: { type: Number, default: 1, min: 0 },
}, { _id: true });

const roadmapSkillSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  priority: { type: String, enum: ["High", "Medium", "Low"], default: "Low" },
  order: { type: Number, default: 0 },
  reason: { type: String, default: "" },
  prerequisites: { type: [String], default: [] },
  status: { type: String, enum: ["Not Started", "In Progress", "Completed"], default: "Not Started" },
  topics: { type: [roadmapTopicSchema], default: [] },
  officialResource: { title: { type: String, default: "" }, url: { type: String, default: "" } },
  youtubeSearchUrl: { type: String, default: "" },
  youtubeVideos: [{ title: String, channel: String, url: String, thumbnail: String }],
}, { _id: true });

const careerRoadmapSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  targetRole: { type: String, required: true, trim: true },
  sourceFingerprint: { type: String, default: "" },
  generatedAt: { type: Date, default: Date.now },
  skills: { type: [roadmapSkillSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model("CareerRoadmap", careerRoadmapSchema);
