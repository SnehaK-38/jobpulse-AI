const Job = require("../models/Job");
const User = require("../models/User");

const clean = (value) => String(value ?? "").trim();

const canonicalSkill = (value) => {
  const skill = clean(value).toLowerCase().replace(/\s+/g, " ");
  const aliases = {
    "js": "javascript",
    "javascript es6": "javascript",
    "node.js": "nodejs",
    "node js": "nodejs",
    "react.js": "react",
    "reactjs": "react",
    "mongo db": "mongodb",
    "mongo": "mongodb",
    "postgres": "postgresql",
    "ml": "machine learning",
    "artificial intelligence": "ai",
    "c sharp": "c#",
    "c plus plus": "c++",
  };
  return aliases[skill] || skill;
};

const uniqueSkills = (values = []) => {
  const result = new Map();
  for (const value of values) {
    const display = clean(value);
    const key = canonicalSkill(display);
    if (key && !result.has(key)) result.set(key, display);
  }
  return result;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getRoleRelevance = (job, role) => {
  const roleWords = clean(role).toLowerCase().split(/[^a-z0-9+#.]+/).filter((word) => word.length > 2);
  if (!roleWords.length) return 100;

  const title = clean(job.title).toLowerCase();
  const context = `${title} ${clean(job.description)} ${clean(job.requirements)}`.toLowerCase();
  const titleMatches = roleWords.filter((word) => title.includes(word)).length;
  const contextMatches = roleWords.filter((word) => context.includes(word)).length;

  if (title.includes(clean(role).toLowerCase())) return 100;
  return Math.min(100, Math.round(
    (titleMatches / roleWords.length) * 70 +
    (contextMatches / roleWords.length) * 30
  ));
};

const isExplicitlyRequired = (skill, job) => {
  const requirementText = `${clean(job.requirements)} ${clean(job.description)} ${clean(job.qualifications)}`;
  if (!requirementText) return false;
  const skillPattern = new RegExp(`(^|[^a-z0-9+#])${escapeRegex(skill)}([^a-z0-9+#]|$)`, "i");
  const requiredPattern = /\b(required|must[- ]have|mandatory|essential|proficient|strong knowledge of|experience with)\b/i;
  return skillPattern.test(requirementText) && requiredPattern.test(requirementText);
};

const getSkillGapOverview = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Please log in to view your skill gap analysis." });
    }

    const user = await User.findById(userId)
      .select("fullName targetRole skills resumeSkills resumeOriginalName")
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User profile not found." });
    }

    const profileSkills = uniqueSkills([
      ...(Array.isArray(user.resumeSkills) ? user.resumeSkills : []),
      ...(Array.isArray(user.skills) ? user.skills : []),
    ]);

    const role = clean(user.targetRole);
    const cachedJobs = await Job.find({})
      .select("title company description requirements qualifications skills detectedJobSkills location source scrapedAt")
      .sort({ postedDate: -1, scrapedAt: -1 })
      .limit(500)
      .lean();

    const relevantJobs = cachedJobs
      .map((job) => ({ ...job, roleRelevance: getRoleRelevance(job, role) }))
      .filter((job) => !role || job.roleRelevance > 0);

    const skillStats = new Map();
    const matchedSkillKeys = new Set();

    for (const job of relevantJobs) {
      const jobSkills = uniqueSkills([
        ...(Array.isArray(job.skills) ? job.skills : []),
        ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
      ]);

      for (const [key, display] of jobSkills.entries()) {
        if (profileSkills.has(key)) {
          matchedSkillKeys.add(key);
          continue;
        }

        if (!skillStats.has(key)) {
          skillStats.set(key, {
            key,
            name: display,
            jobCount: 0,
            requiredCount: 0,
            relevanceTotal: 0,
          });
        }

        const stat = skillStats.get(key);
        stat.jobCount += 1;
        stat.relevanceTotal += job.roleRelevance;
        if (isExplicitlyRequired(display, job)) stat.requiredCount += 1;
      }
    }

    const maxDemand = Math.max(1, ...Array.from(skillStats.values()).map((item) => item.jobCount));
    const missingSkills = Array.from(skillStats.values()).map((item) => {
      const demandScore = (item.jobCount / maxDemand) * 100;
      const importanceScore = item.jobCount ? (item.requiredCount / item.jobCount) * 100 : 0;
      const roleScore = item.jobCount ? item.relevanceTotal / item.jobCount : 0;
      const priorityScore = Math.round(
        demandScore * 0.5 + importanceScore * 0.3 + roleScore * 0.2
      );

      return {
        name: item.name,
        jobCount: item.jobCount,
        requiredCount: item.requiredCount,
        priorityScore,
        priority: priorityScore >= 65 ? "High" : priorityScore >= 35 ? "Medium" : "Low",
      };
    }).sort((a, b) => b.priorityScore - a.priorityScore || b.jobCount - a.jobCount || a.name.localeCompare(b.name));

    const allJobSkillKeys = new Set();
    let matchedOccurrences = 0;
    let totalOccurrences = 0;

    for (const job of relevantJobs) {
      const jobSkills = uniqueSkills([
        ...(Array.isArray(job.skills) ? job.skills : []),
        ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
      ]);
      for (const key of jobSkills.keys()) {
        allJobSkillKeys.add(key);
        totalOccurrences += 1;
        if (profileSkills.has(key)) matchedOccurrences += 1;
      }
    }

    const matchedSkills = Array.from(allJobSkillKeys)
      .filter((key) => profileSkills.has(key))
      .map((key) => profileSkills.get(key));

    const coverage = totalOccurrences
      ? Math.round((matchedOccurrences / totalOccurrences) * 100)
      : 0;

    return res.json({
      success: true,
      profile: {
        fullName: user.fullName || "",
        targetRole: role,
        currentSkills: Array.from(profileSkills.values()).sort((a, b) => a.localeCompare(b)),
      },
      summary: {
        jobsAnalysed: relevantJobs.length,
        matchedSkills: matchedSkills.length,
        missingSkills: missingSkills.length,
        highPrioritySkills: missingSkills.filter((skill) => skill.priority === "High").length,
        coverage,
      },
      matchedSkills,
      missingSkills,
      message: relevantJobs.length
        ? ""
        : role
          ? "No cached jobs matched your target role yet. Visit Job Search to fetch relevant opportunities, then refresh this analysis."
          : "Add a target role in your profile and fetch jobs to build a role-specific skill gap analysis.",
    });
  } catch (error) {
    console.error("getSkillGapOverview error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to generate skill gap analysis.",
    });
  }
};

module.exports = { getSkillGapOverview };
