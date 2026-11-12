const mongoose = require("mongoose");

const jobShortlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  jobId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Job",
    required: true,
  },
  // Keep a compact snapshot so the saved item remains readable if a job
  // listing is later refreshed or removed from the shared jobs collection.
  jobSnapshot: {
    title: { type: String, default: "" },
    company: { type: String, default: "" },
    location: { type: String, default: "" },
    workMode: { type: String, default: "" },
    experience: { type: String, default: "" },
    salary: { type: String, default: "" },
    skills: { type: [String], default: [] },
    source: { type: String, default: "" },
    jobUrl: { type: String, default: "" },
    applicationUrl: { type: String, default: "" },
  },
}, { timestamps: true });

jobShortlistSchema.index({ userId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model("JobShortlist", jobShortlistSchema);
