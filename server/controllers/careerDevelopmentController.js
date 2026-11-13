const mongoose = require("mongoose");
const CareerDevelopment = require("../models/CareerDevelopment");
const User = require("../models/User");
const Job = require("../models/Job");
const { ROLE_CATALOG, LEARNING_GUIDES } = require("../data/careerRoleCatalog");

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
    const roleResults = ROLE_CATALOG.map((role) => {
      const matchedSkills = role.skills.filter((skill) => currentSkills.some((current) => norm(current) === norm(skill)));
      const missingSkills = role.skills.filter((skill) => !matchedSkills.some((matched) => norm(matched) === norm(skill)));
      const skillFit = role.skills.length ? Math.round((matchedSkills.length / role.skills.length) * 100) : 0;
      const matchedInterests = role.interests.filter((interest) => interests.some((selected) => norm(selected) === norm(interest)));
      const interestFit = interests.length ? Math.round(matchedInterests.length / Math.max(role.interests.length, 1) * 100) : 0;
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
      selectedRole: saved?.selectedRole || user.targetRole || "",
      roles: roleResults,
      roadmap: saved?.roadmap || [],
      roadmapUpdatedAt: saved?.roadmapUpdatedAt || null,
      marketData: { totalStoredListings, listingsSampled: jobs.length, lastListingUpdate: jobs.reduce((latest, job) => job.scrapedAt && (!latest || job.scrapedAt > latest) ? job.scrapedAt : latest, null) },
      catalogueNote: "Career roles and learning guides use a curated catalogue. Job demand is estimated from a sample of up to 300 recently stored JobPulse listings; it is not a complete labour-market census.",
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
    const allowed = new Set(["Web Development", "Software Development", "Backend Systems", "UI Development", "Data Analytics", "Business Intelligence", "Artificial Intelligence", "Machine Learning", "Data Science", "Software Testing", "Quality Engineering", "Cloud Computing", "Automation", "Cybersecurity", "Networking", "Product Design", "Infrastructure", "Mobile App Development", "Android Development", "iOS Development", "Data Engineering", "Big Data", "Business Analysis", "AWS", "Microsoft Azure", "Site Reliability Engineering", "Platform Engineering", "Automation Testing", "Manual Testing", "Performance Testing", "Application Security", "Network Security", "Database Management", "Product Management", "Product Strategy", "Generative AI", "Deep Learning", "Natural Language Processing", "Computer Vision", "MLOps", "Blockchain", "Game Development", "3D Graphics", "Technical Support", "IT Operations", "Technical Writing", "Documentation", "Frontend Development", "Interaction Design", "Research", "Application Engineering"]);
    const interests = unique(Array.isArray(req.body?.interests) ? req.body.interests : []).filter((item) => allowed.has(item)).slice(0, 12);
    const selectedRole = clean(req.body?.selectedRole).slice(0, 100);
    if (selectedRole && !ROLE_CATALOG.some((role) => norm(role.title) === norm(selectedRole))) {
      return res.status(400).json({ success: false, message: "Please select a career role from the available recommendations." });
    }
    const saved = await CareerDevelopment.findOneAndUpdate(
      { userId },
      { $set: { interests, selectedRole } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, interests: saved.interests, selectedRole: saved.selectedRole });
  } catch (error) {
    console.error("Save career preferences:", error);
    return res.status(500).json({ success: false, message: "Unable to save career preferences." });
  }
};

const generateRoadmap = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to generate a learning roadmap." });
    const roleName = clean(req.body?.role);
    const role = ROLE_CATALOG.find((item) => norm(item.title) === norm(roleName));
    if (!role) return res.status(400).json({ success: false, message: "Choose a supported career role first." });
    const user = await User.findById(userId).select("skills resumeSkills").lean();
    if (!user) return res.status(404).json({ success: false, message: "User profile not found." });
    const currentSkills = unique([...(user.skills || []), ...(user.resumeSkills || [])]);
    const missing = role.skills.filter((skill) => !currentSkills.some((current) => norm(current) === norm(skill)));
    if (!missing.length) return res.status(400).json({ success: false, message: "Your profile already contains all skills in this starter role catalogue. Update your target role or explore an advanced role." });

    const previous = await CareerDevelopment.findOne({ userId }).lean();
    const previousStatus = new Map((previous?.roadmap || []).map((item) => [norm(item.skill), item.status]));
    const jobs = await Job.find({}).sort({ scrapedAt: -1 }).limit(300).select("skills detectedJobSkills title description requirements qualifications responsibilities").lean();
    const roadmap = missing.map((skill, index) => {
      const guide = LEARNING_GUIDES[skill] || {
        weeks: 2,
        topics: ["Understand the core concepts", "Practise the main tools and workflow", "Apply the skill in a small project"],
        resource: ["Find official learning documentation", "https://www.google.com/search?q=" + encodeURIComponent(skill + " official documentation")],
        task: "Build a small practical exercise that demonstrates " + skill + ".",
      };
      const demand = jobs.filter((job) => matchesSkill(skill, job)).length;
      const demandRate = jobs.length ? demand / jobs.length : 0;
      const priority = demandRate >= 0.05 ? "High" : demandRate >= 0.01 ? "Medium" : "Low";
      return {
        skill,
        priority,
        reason: demand
          ? "This skill is part of the selected " + role.title + " role and appears in " + demand + " stored job listings."
          : "This skill is included in the selected " + role.title + " role's curated skill requirements. Current stored listings provide limited demand evidence.",
        estimatedWeeks: guide.weeks,
        status: previousStatus.get(norm(skill)) || "Not Started",
        topics: guide.topics,
        resource: { title: guide.resource[0], url: guide.resource[1] },
        practiceTask: guide.task,
        order: index + 1,
      };
    }).sort((a, b) => ({High:0,Medium:1,Low:2}[a.priority] - {High:0,Medium:1,Low:2}[b.priority]) || a.order - b.order)
      .map((item, index) => ({ ...item, order: index + 1 }));

    const saved = await CareerDevelopment.findOneAndUpdate(
      { userId },
      { $set: { selectedRole: role.title, roadmap, roadmapUpdatedAt: new Date() } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, roadmap: saved.roadmap, selectedRole: saved.selectedRole });
  } catch (error) {
    console.error("Generate learning roadmap:", error);
    return res.status(500).json({ success: false, message: "Unable to generate the learning roadmap." });
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
      { new: true, runValidators: true }
    ).lean();
    if (!saved) return res.status(404).json({ success: false, message: "Roadmap item not found." });
    return res.json({ success: true, roadmap: saved.roadmap });
  } catch (error) {
    console.error("Update roadmap progress:", error);
    return res.status(500).json({ success: false, message: "Unable to update learning progress." });
  }
};

module.exports = { getOverview, savePreferences, generateRoadmap, updateRoadmapStatus };
