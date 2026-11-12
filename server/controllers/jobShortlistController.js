const mongoose = require("mongoose");
const Job = require("../models/Job");
const JobShortlist = require("../models/JobShortlist");

const getUserId = (req) => req.user?._id || req.user?.id || req.user?.userId;

const getJobSnapshot = (job) => ({
  title: job.title || "",
  company: job.company || "",
  location: job.location || "",
  workMode: job.workMode || (job.isRemote ? "Remote" : ""),
  experience: job.experience || job.experienceLevel || "",
  salary: job.salary || "Not specified",
  skills: [...new Set([
    ...(Array.isArray(job.skills) ? job.skills : []),
    ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
  ].map((skill) => String(skill).trim()).filter(Boolean))],
  source: job.source || "",
  jobUrl: job.jobUrl || "",
  applicationUrl: job.applicationUrl || job.jobUrlDirect || job.jobUrl || "",
});

const getShortlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to view your shortlist." });

    const saved = await JobShortlist.find({ userId }).sort({ createdAt: -1 }).lean();
    const jobIds = saved.map((item) => item.jobId).filter(Boolean);
    const currentJobs = await Job.find({ _id: { $in: jobIds } })
      .select("title company location workMode isRemote experience experienceLevel salary skills detectedJobSkills source jobUrl jobUrlDirect applicationUrl")
      .lean();
    const currentById = new Map(currentJobs.map((job) => [String(job._id), job]));

    return res.json({
      success: true,
      jobs: saved.map((item) => ({
        _id: String(item.jobId),
        savedAt: item.createdAt,
        ...(currentById.get(String(item.jobId))
          ? getJobSnapshot(currentById.get(String(item.jobId)))
          : item.jobSnapshot),
        listingAvailable: currentById.has(String(item.jobId)),
      })),
    });
  } catch (error) {
    console.error("getShortlist error:", error);
    return res.status(500).json({ success: false, message: "Unable to load your shortlist." });
  }
};

const addToShortlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    const jobId = String(req.body?.jobId || "");
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to save jobs." });
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ success: false, message: "A valid job must be selected." });
    }

    const job = await Job.findById(jobId)
      .select("title company location workMode isRemote experience experienceLevel salary skills detectedJobSkills source jobUrl jobUrlDirect applicationUrl")
      .lean();
    if (!job) return res.status(404).json({ success: false, message: "This job listing is no longer available." });

    const saved = await JobShortlist.findOneAndUpdate(
      { userId, jobId },
      { $setOnInsert: { userId, jobId, jobSnapshot: getJobSnapshot(job) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, message: "Job added to your shortlist.", jobId: String(saved.jobId) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(200).json({ success: true, message: "This job is already in your shortlist." });
    }
    console.error("addToShortlist error:", error);
    return res.status(500).json({ success: false, message: "Unable to save this job." });
  }
};

const removeFromShortlist = async (req, res) => {
  try {
    const userId = getUserId(req);
    const jobId = String(req.params.jobId || "");
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to update your shortlist." });
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ success: false, message: "Invalid job selection." });
    }
    await JobShortlist.deleteOne({ userId, jobId });
    return res.json({ success: true, message: "Job removed from your shortlist." });
  } catch (error) {
    console.error("removeFromShortlist error:", error);
    return res.status(500).json({ success: false, message: "Unable to remove this job." });
  }
};

module.exports = { getShortlist, addToShortlist, removeFromShortlist };
