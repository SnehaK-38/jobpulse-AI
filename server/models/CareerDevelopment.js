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

const missingSkillRoadmapItemSchema = new mongoose.Schema({
  skill: { type: String, required: true, trim: true },
  priority: { type: String, enum: ["High", "Medium", "Low"], default: "Medium" },
  reason: { type: String, default: "" },
  jobCount: { type: Number, default: 0, min: 0 },
  requiredCount: { type: Number, default: 0, min: 0 },
  estimatedWeeks: { type: Number, default: 2, min: 1, max: 52 },
  status: { type: String, enum: ["Not Started", "In Progress", "Completed"], default: "Not Started" },
  topics: { type: [String], default: [] },
  resources: [{
    title: { type: String, default: "" },
    provider: { type: String, default: "" },
    url: { type: String, default: "" },
    type: { type: String, default: "Course" }
  }],
  practiceTask: { type: String, default: "" },
  prerequisites: { type: [String], default: [] },
  project: { type: mongoose.Schema.Types.Mixed, default: null },
  assessment: { type: mongoose.Schema.Types.Mixed, default: null },
  order: { type: Number, default: 0 },
}, { _id: true });

const careerDevelopmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  interests: { type: [String], default: [] },
  generatedRoles: { type: [mongoose.Schema.Types.Mixed], default: [] },
  generatedRolesAt: { type: Date, default: null },
  selectedRole: { type: String, default: "" },
  roadmap: { type: [roadmapItemSchema], default: [] },
  roadmapUpdatedAt: { type: Date, default: null },
  missingSkillsRoadmap: { type: [missingSkillRoadmapItemSchema], default: [] },
  missingSkillsRoadmapRole: { type: String, default: "" },
  missingSkillsRoadmapUpdatedAt: { type: Date, default: null },
  missingSkillsWeeklyPlan: { type: mongoose.Schema.Types.Mixed, default: null },
  missingSkillsWeeklyPlanRole: { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model("CareerDevelopment", careerDevelopmentSchema);
