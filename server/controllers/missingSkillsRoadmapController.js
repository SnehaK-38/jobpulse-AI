const mongoose = require("mongoose");
const CareerDevelopment = require("../models/CareerDevelopment");
const User = require("../models/User");
const Job = require("../models/Job");
const { askGemini } = require("./geminiCareerController");
const { getLearningResources } = require("../data/learningResourceCatalog");

const clean = (value) => String(value == null ? "" : value).trim();
const norm = (value) => clean(value).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const userIdOf = (req) => req.user && (req.user._id || req.user.id || req.user.userId);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unique = (values) => [...new Map((values || []).map((value) => [norm(value), clean(value)]).filter(([key, value]) => key && value)).values()];

const skillAppearsInJob = (skill, job) => {
  const structured = [...(job.skills || []), ...(job.detectedJobSkills || [])];
  if (structured.some((value) => norm(value) === norm(skill))) return true;
  const text = [job.title, job.description, job.requirements, job.qualifications, job.responsibilities].map(clean).join(" ").toLowerCase();
  const pattern = escapeRegex(skill).split(/\s+/).join("\\s+");
  return new RegExp("(^|[^a-z0-9])" + pattern + "(?=$|[^a-z0-9])", "i").test(text);
};

const skillIsRequired = (skill, job) => {
  const text = [job.requirements, job.qualifications, job.description].map(clean).join(" ");
  const escaped = escapeRegex(skill);
  return new RegExp("(required|must[- ]have|mandatory|essential|proficient(?: in)?|experience with|experience in|knowledge of)[^.!?;\\n]{0,55}" + escaped, "i").test(text);
};

const getMissingSkillsRoadmap = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to view your learning roadmap." });
    const saved = await CareerDevelopment.findOne({ userId })
      .select("missingSkillsRoadmap missingSkillsRoadmapRole missingSkillsRoadmapUpdatedAt")
      .lean();
    return res.json({
      success: true,
      targetRole: saved?.missingSkillsRoadmapRole || "",
      roadmap: saved?.missingSkillsRoadmap || [],
      updatedAt: saved?.missingSkillsRoadmapUpdatedAt || null,
    });
  } catch (error) {
    console.error("Get Missing Skills Roadmap:", error);
    return res.status(500).json({ success: false, message: "Unable to load your saved learning roadmap." });
  }
};

const generateMissingSkillsRoadmap = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to generate your learning roadmap." });

    const jobIds = Array.isArray(req.body?.jobIds) ? [...new Set(req.body.jobIds.map(clean).filter(mongoose.isValidObjectId))] : [];
    const requestedSkills = Array.isArray(req.body?.missingSkills) ? req.body.missingSkills : [];
    if (!jobIds.length || !requestedSkills.length) {
      return res.status(400).json({ success: false, message: "Refresh Skill Gap Analysis first so the roadmap can use your current missing skills and job listings." });
    }

    const [user, jobs, saved] = await Promise.all([
      User.findById(userId).select("targetRole skills resumeSkills").lean(),
      Job.find({ _id: { $in: jobIds } }).select("title description requirements qualifications responsibilities skills detectedJobSkills").lean(),
      CareerDevelopment.findOne({ userId }).lean()
    ]);
    if (!user) return res.status(404).json({ success: false, message: "User profile not found." });
    if (!jobs.length) return res.status(400).json({ success: false, message: "The analysed job listings are no longer available. Refresh the analysis and try again." });

    const currentSkills = unique([...(user.skills || []), ...(user.resumeSkills || [])]);
    const currentKeys = new Set(currentSkills.map(norm));
    const candidateNames = unique(requestedSkills.map((item) => typeof item === "string" ? item : item?.name))
      .filter((skill) => !currentKeys.has(norm(skill)));
    const evidence = candidateNames.map((skill) => {
      const matchingJobs = jobs.filter((job) => skillAppearsInJob(skill, job));
      const requiredCount = matchingJobs.filter((job) => skillIsRequired(skill, job)).length;
      const supplied = requestedSkills.find((item) => norm(typeof item === "string" ? item : item?.name) === norm(skill));
      return {
        skill,
        jobCount: matchingJobs.length,
        requiredCount,
        requirementRate: matchingJobs.length ? Math.round(requiredCount / matchingJobs.length * 100) : 0,
        suggestedPriority: typeof supplied === "object" && ["High", "Medium", "Low"].includes(supplied.priority) ? supplied.priority : "Medium"
      };
    }).filter((item) => item.jobCount > 0);

    if (!evidence.length) {
      return res.status(400).json({ success: false, message: "No current missing skills could be verified in the selected job listings. Refresh your analysis." });
    }

    evidence.sort((a, b) => b.jobCount - a.jobCount || b.requiredCount - a.requiredCount || a.skill.localeCompare(b.skill));
    const highEnd = Math.ceil(evidence.length * 0.25);
    const mediumEnd = Math.ceil(evidence.length * 0.75);
    evidence.forEach((item, index) => {
      item.priority = index < highEnd ? "High" : index < mediumEnd ? "Medium" : "Low";
    });

    const previousStatus = new Map((saved?.missingSkillsRoadmap || []).map((item) => [norm(item.skill), item.status]));
    const prompt = "You are a practical technical learning-path designer. Create a realistic, beginner-friendly but career-relevant learning sequence for the user's missing skills. Return JSON only: { items: [{ skill, reason, estimatedWeeks, topics: string[], practiceTask, prerequisites: string[] }] }. Include exactly one item for every skill supplied; do not invent additional skills or omit any. Keep skill names exactly as supplied. Order foundational skills before skills that depend on them. A prerequisite must be another skill in this list; use an empty array when none is needed. Topics must be concrete subtopics, not vague phrases. Each practiceTask must be a small portfolio-ready exercise or mini-project. Estimated duration should be realistic for a learner studying 5-7 hours weekly, between 1 and 8 weeks per skill. Explain why each skill matters for this target role, using the provided job evidence but do not invent counts. Target role: " + clean(user.targetRole) + ". Existing skills (do not add these to the roadmap): " + JSON.stringify(currentSkills) + ". Verified missing skills and evidence: " + JSON.stringify(evidence) + ".";
    const generated = await askGemini(prompt, "missing skills roadmap");
    const generatedItems = Array.isArray(generated.items) ? generated.items : [];
    const generatedBySkill = new Map(generatedItems.map((item) => [norm(item.skill), item]));
    const missingGenerated = evidence.filter((item) => !generatedBySkill.has(norm(item.skill)));
    if (missingGenerated.length) {
      throw new Error("The learning plan response was incomplete for: " + missingGenerated.map((item) => item.skill).join(", ") + ". Please try again.");
    }

    const items = evidence.map((item) => {
      const generatedItem = generatedBySkill.get(norm(item.skill));
      const prerequisites = unique(generatedItem.prerequisites || []).filter((name) => evidence.some((candidate) => norm(candidate.skill) === norm(name)) && norm(name) !== norm(item.skill));
      return {
        skill: item.skill,
        priority: item.priority,
        reason: clean(generatedItem.reason) || ("Appears in " + item.jobCount + " of the analysed job listings for " + clean(user.targetRole) + "."),
        jobCount: item.jobCount,
        requiredCount: item.requiredCount,
        estimatedWeeks: Math.max(1, Math.min(8, Number(generatedItem.estimatedWeeks) || 2)),
        status: previousStatus.get(norm(item.skill)) || "Not Started",
        topics: unique(generatedItem.topics || []).slice(0, 6),
        resources: getLearningResources(item.skill),
        practiceTask: clean(generatedItem.practiceTask),
        prerequisites,
      };
    });

    if (items.some((item) => item.topics.length < 2 || !item.practiceTask)) {
      throw new Error("The learning plan is missing practical topics or project tasks. Please regenerate it.");
    }

    const priorityRank = { High: 0, Medium: 1, Low: 2 };
    items.sort((a, b) => {
      const aPrerequisite = items.some((candidate) => candidate.prerequisites.some((name) => norm(name) === norm(a.skill)));
      const bPrerequisite = items.some((candidate) => candidate.prerequisites.some((name) => norm(name) === norm(b.skill)));
      if (aPrerequisite !== bPrerequisite) return aPrerequisite ? -1 : 1;
      return priorityRank[a.priority] - priorityRank[b.priority] || b.jobCount - a.jobCount;
    });
    items.forEach((item, index) => { item.order = index + 1; });

    const result = await CareerDevelopment.findOneAndUpdate(
      { userId },
      { $set: { missingSkillsRoadmap: items, missingSkillsRoadmapRole: clean(user.targetRole), missingSkillsRoadmapUpdatedAt: new Date() } },
      { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    console.log("Missing Skills Roadmap generated | user=" + String(userId) + " | role=" + clean(user.targetRole) + " | skills=" + items.length);
    return res.json({
      success: true,
      targetRole: result.missingSkillsRoadmapRole,
      roadmap: result.missingSkillsRoadmap,
      updatedAt: result.missingSkillsRoadmapUpdatedAt,
      jobsAnalysed: jobs.length,
    });
  } catch (error) {
    console.error("Generate Missing Skills Roadmap:", error.response?.status || error.status, error.message);
    return res.status(error.status || 502).json({
      success: false,
      message: error.message || "Unable to generate your Missing Skills Roadmap."
    });
  }
};

const updateMissingSkillStatus = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to update your learning progress." });
    if (!mongoose.isValidObjectId(req.params.itemId)) return res.status(400).json({ success: false, message: "Invalid roadmap skill." });
    const status = clean(req.body?.status);
    if (!["Not Started", "In Progress", "Completed"].includes(status)) return res.status(400).json({ success: false, message: "Choose a valid learning status." });
    const saved = await CareerDevelopment.findOneAndUpdate(
      { userId, "missingSkillsRoadmap._id": req.params.itemId },
      { $set: { "missingSkillsRoadmap.$.status": status } },
      { returnDocument: "after", runValidators: true }
    ).lean();
    if (!saved) return res.status(404).json({ success: false, message: "Roadmap skill not found." });
    return res.json({ success: true, roadmap: saved.missingSkillsRoadmap });
  } catch (error) {
    console.error("Update Missing Skills Roadmap status:", error);
    return res.status(500).json({ success: false, message: "Unable to update learning progress." });
  }
};

module.exports = { getMissingSkillsRoadmap, generateMissingSkillsRoadmap, updateMissingSkillStatus };
