const mongoose = require("mongoose");
const CareerDevelopment = require("../models/CareerDevelopment");
const User = require("../models/User");
const Job = require("../models/Job");

const clean = (value) => String(value == null ? "" : value).trim();
const norm = (value) => clean(value).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const userIdOf = (req) => req.user && (req.user._id || req.user.id || req.user.userId);
const unique = (values) => [...new Map((values || []).map((v) => [norm(v), clean(v)]).filter(([k,v]) => k && v)).values()];

const matchesSkill = (skill, job) => {
  const variants = {
    "node.js": ["node.js", "nodejs", "node js"],
    "express.js": ["express.js", "express js", "express"],
    "rest api": ["rest api", "restful api", "rest apis"],
    "power bi": ["power bi", "powerbi"],
    "machine learning": ["machine learning", "ml"],
    "software testing": ["software testing", "testing", "quality assurance", "qa"],
    "ui design": ["ui design", "user interface design"],
    "ux research": ["ux research", "user experience research"],
    "data visualization": ["data visualization", "data visualisation"],
    "shell scripting": ["shell scripting", "bash scripting"],
  };
  const terms = variants[norm(skill)] || [skill];
  const text = [
    ...(Array.isArray(job.skills) ? job.skills : []),
    ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
    job.title, job.description, job.requirements, job.qualifications, job.responsibilities,
  ].map(clean).join(" ").toLowerCase();
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + escaped.replace(/\s+/g, "\\s+") + "(?=$|[^a-z0-9])", "i").test(text);
  });
};

const getOverview = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to use Career Navigator." });
    const [user, saved, jobs, totalStoredListings] = await Promise.all([
      User.findById(userId).select("fullName targetRole skills resumeSkills preferredIndustry preferredLocation").lean(),
      CareerDevelopment.findOne({ userId }).lean(),
      Job.find({}).sort({ scrapedAt: -1 }).limit(300)
        .select("title skills detectedJobSkills description requirements qualifications responsibilities location source scrapedAt").lean(),
      Job.countDocuments({}),
    ]);
    if (!user) return res.status(404).json({ success: false, message: "User profile not found." });

    const currentSkills = unique([...(user.skills || []), ...(user.resumeSkills || [])]);
    const interests = saved?.interests || [];
    const roleSource = saved?.generatedRoles || [];
    const roleResults = roleSource.map((role) => {
      const matchedSkills = role.skills.filter((skill) => currentSkills.some((current) => norm(current) === norm(skill)));
      const missingSkills = role.skills.filter((skill) => !matchedSkills.some((matched) => norm(matched) === norm(skill)));
      const skillFit = role.skills.length ? Math.round((matchedSkills.length / role.skills.length) * 100) : 0;
      const matchedInterests = role.interests.filter((interest) => interests.some((selected) => norm(selected) === norm(interest)));
      const interestFit = role.interests.length ? Math.round(matchedInterests.length / role.interests.length * 100) : 0;
      const demandCount = jobs.filter((job) => matchesSkill(role.skills[0], job) || norm(job.title).includes(norm(role.title))).length;
      const demandSkillCount = role.skills.reduce((count, skill) => count + jobs.filter((job) => matchesSkill(skill, job)).length, 0);
      const demandFit = jobs.length ? Math.min(100, Math.round(demandSkillCount / (jobs.length * role.skills.length) * 100)) : 0;
      const weights = { skills: 60, interests: interests.length ? 25 : 0, demand: jobs.length ? 15 : 0 };
      const activeWeight = weights.skills + weights.interests + weights.demand;
      const score = Math.round((skillFit * weights.skills + interestFit * weights.interests + demandFit * weights.demand) / activeWeight);
      return { ...role, matchedSkills, missingSkills, skillFit, matchedInterests, interestFit, demandFit, demandCount, demandSkillCount, scoreBreakdown: weights, recommendationScore: score };
    }).filter((role) => !interests.length || role.matchedInterests.length > 0)
      .sort((a, b) => b.recommendationScore - a.recommendationScore || b.demandCount - a.demandCount);

    return res.json({
      success: true,
      profile: { fullName: user.fullName, targetRole: user.targetRole || "", currentSkills, preferredIndustry: user.preferredIndustry || "", preferredLocation: user.preferredLocation || "" },
      interests,
      selectedRole: saved?.selectedRole || "",
      roles: roleResults,
      roadmap: saved?.roadmap || [],
      roadmapUpdatedAt: saved?.roadmapUpdatedAt || null,
      marketData: { totalStoredListings, listingsSampled: jobs.length, lastListingUpdate: jobs.reduce((latest, job) => job.scrapedAt && (!latest || job.scrapedAt > latest) ? job.scrapedAt : latest, null) },
      catalogueNote: "Career paths and required skills are generated by Gemini. Skill match is calculated against your saved profile. Job demand is estimated from a sample of recently stored JobPulse listings, not a complete labour-market census.",
    });
  } catch (error) {
    console.error("Career development overview:", error);
    return res.status(500).json({ success: false, message: "Unable to load career recommendations." });
  }
};

const savePreferences = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to save your career interests." });
    const interests = unique(Array.isArray(req.body?.interests) ? req.body.interests : [])
      .filter((item) => item.length <= 80)
      .slice(0, 12);
    const selectedRole = clean(req.body?.selectedRole).slice(0, 100);
    const existing = await CareerDevelopment.findOne({ userId }).select("generatedRoles").lean();
    const validRoles = existing?.generatedRoles || [];
    if (selectedRole && !validRoles.some((role) => norm(role.title) === norm(selectedRole))) {
      return res.status(400).json({ success: false, message: "Please select a career role from the available recommendations." });
    }
    const saved = await CareerDevelopment.findOneAndUpdate(
      { userId },
      { $set: { interests, selectedRole } },
      { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, interests: saved.interests, selectedRole: saved.selectedRole });
  } catch (error) {
    console.error("Save career preferences:", error);
    return res.status(500).json({ success: false, message: "Unable to save career preferences." });
  }
};

const updateRoadmapStatus = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to update progress." });
    if (!mongoose.isValidObjectId(req.params.itemId)) return res.status(400).json({ success: false, message: "Invalid roadmap item." });
    const status = clean(req.body?.status);
    if (!["Not Started", "In Progress", "Completed"].includes(status)) return res.status(400).json({ success: false, message: "Choose a valid learning status." });
    const saved = await CareerDevelopment.findOneAndUpdate(
      { userId, "roadmap._id": req.params.itemId },
      { $set: { "roadmap.$.status": status } },
      { returnDocument: "after", runValidators: true }
    ).lean();
    if (!saved) return res.status(404).json({ success: false, message: "Roadmap item not found." });
    return res.json({ success: true, roadmap: saved.roadmap });
  } catch (error) {
    console.error("Update roadmap progress:", error);
    return res.status(500).json({ success: false, message: "Unable to update learning progress." });
  }
};

module.exports = { getOverview, savePreferences, updateRoadmapStatus };
