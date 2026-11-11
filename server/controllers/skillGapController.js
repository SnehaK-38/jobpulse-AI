const Job = require("../models/Job");
const User = require("../models/User");

// Generic job terms and ambiguous fragments are not useful standalone skills.
// Specific technologies such as Apache Kafka and Apache Spark remain valid.
const EXCLUDED_SKILL_TERMS = new Set([
  "admin", "administrator", "administration", "sales",
  "software engineering", "software development", "business",
  "business development", "management", "leadership",
  "communication", "teamwork", "problem solving", "customer service",
  "customer support", "technical support", "operations", "marketing",
  "recruitment", "human resources", "hr", "documentation",
  "responsibilities", "requirements", "qualifications", "job description",
  "apache",
  "engineer", "engineering", "developer", "development",
  "senior", "junior", "mid-level", "entry-level", "lead",
  "staff", "principal", "associate", "intern", "internship",
  "manager", "management", "architect", "analyst", "specialist",
  "consultant", "director", "executive", "coordinator",
  "professional", "fresher", "years", "year", "experience",
  "role", "position", "job", "candidate", "team",
]);

const clean = (value) => String(value ?? "").trim();

const canonicalSkill = (value) => {
  const skill = clean(value).toLowerCase().replace(/\s+/g, " ");
  const aliases = {
    js: "javascript",
    "javascript es6": "javascript",
    "node.js": "nodejs",
    "node js": "nodejs",
    "react.js": "react",
    reactjs: "react",
    "mongo db": "mongodb",
    mongo: "mongodb",
    postgres: "postgresql",
    ml: "machine learning",
    "artificial intelligence": "ai",
    "c sharp": "c#",
    "c plus plus": "c++",
    "apache kafka": "kafka",
    "apache spark": "spark",
    "apache airflow": "airflow",
    "apache hadoop": "hadoop",
    "apache flink": "flink",
    "apache maven": "maven",
    "apache tomcat": "tomcat",
    "apache http server": "apache http server",
  };
  return aliases[skill] || skill;
};

const isUsefulSkill = (value) => {
  const key = canonicalSkill(value);
  if (!key || key.length < 2 || EXCLUDED_SKILL_TERMS.has(key)) return false;
  if (/^(?:[0-9]+|[a-z])$/.test(key)) return false;
  if (key.split(" ").length > 5) return false;
  if (/\b(engineer|engineering|developer|development|senior|junior|lead|staff|principal|associate|intern|manager|management|architect|analyst|specialist|consultant|director|executive|coordinator|fresher|experience|years?)\b/i.test(key)) return false;
  return true;
};

const uniqueSkills = (values = []) => {
  const result = new Map();
  for (const value of values) {
    const display = clean(value);
    const key = canonicalSkill(display);
    if (isUsefulSkill(display) && !result.has(key)) result.set(key, display);
  }
  return result;
};

const escapeRegex = (value) => value.replace(/[.*+?^$()|[\]\\]/g, "\\$&");

const getRoleRelevance = (job, role) => {
  const roleWords = clean(role).toLowerCase().split(/[^a-z0-9+#.]+/).filter((word) => word.length > 2);
  if (!roleWords.length) return 100;

  const title = clean(job.title).toLowerCase();
  const context = (title + " " + clean(job.description) + " " + clean(job.requirements)).toLowerCase();
  const matchedRoleTerms = roleWords.filter((word) => context.includes(word)).length;
  return Math.round((matchedRoleTerms / roleWords.length) * 100);
};

// Count requirement evidence only when the signal is grammatically tied to
// this skill in the same short phrase (not merely somewhere in the description).
const isExplicitlyRequired = (skill, job) => {
  const requirementText = [
    clean(job.requirements),
    clean(job.qualifications),
    clean(job.description),
  ].filter(Boolean).join(" ");
  if (!requirementText) return false;

  const escapedSkill = escapeRegex(skill);
  const signalBeforeSkill = new RegExp(
    "(?:required|must[- ]have|mandatory|essential|proficient(?: in)?|strong knowledge of|experience with|experience in|knowledge of|familiarity with|hands-on experience(?: with)?)(?:[^.!?;\\n]{0,45})\\b" +
      escapedSkill + "\\b",
    "i"
  );
  const signalAfterSkill = new RegExp(
    "\\b" + escapedSkill +
      "\\b(?:[^.!?;\\n]{0,35})(?:(?:is|are)\\s+)?(?:required|mandatory|essential|must[- ]have)",
    "i"
  );

  return signalBeforeSkill.test(requirementText) || signalAfterSkill.test(requirementText);
};

const getJobSkills = (job) => uniqueSkills([
  ...(Array.isArray(job.skills) ? job.skills : []),
  ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
]);

const getSkillGapOverview = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Please log in to view your skill gap analysis." });
    }

    const jobIds = Array.isArray(req.body?.jobIds)
      ? [...new Set(req.body.jobIds.map((id) => clean(id)).filter(Boolean))]
      : [];
    if (!jobIds.length) {
      return res.status(400).json({
        success: false,
        message: "No job results were supplied. Open Job Search and refresh the recommendations first.",
      });
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

    // Analyse the exact stored job records returned by the existing Job Search API.
    const jobs = await Job.find({
      _id: { $in: jobIds },
      $nor: [
        { jobUrl: /jobpulse_id=/i },
        { jobUrl: /linkedin\.com\/jobs\/search/i },
      ],
    })
      .select("title company description requirements qualifications skills detectedJobSkills location source scrapedAt jobUrl")
      .lean();

    const skillStats = new Map();
    for (const job of jobs) {
      const roleRelevance = getRoleRelevance(job, role);
      for (const [key, display] of getJobSkills(job).entries()) {
        if (profileSkills.has(key)) continue;
        if (!skillStats.has(key)) {
          skillStats.set(key, { key, name: display, jobCount: 0, requiredCount: 0, relevanceTotal: 0 });
        }
        const stat = skillStats.get(key);
        stat.jobCount += 1;
        stat.relevanceTotal += roleRelevance;
        if (isExplicitlyRequired(display, job)) stat.requiredCount += 1;
      }
    }

    const missingSkills = Array.from(skillStats.values()).map((item) => ({
      name: item.name,
      jobCount: item.jobCount,
      requiredCount: item.requiredCount,
      requirementRate: item.jobCount
        ? Math.round((item.requiredCount / item.jobCount) * 100)
        : 0,
      averageRoleRelevance: item.jobCount
        ? Math.round(item.relevanceTotal / item.jobCount)
        : 0,
    })).sort((a, b) =>
      b.jobCount - a.jobCount ||
      b.requirementRate - a.requirementRate ||
      b.averageRoleRelevance - a.averageRoleRelevance ||
      a.name.localeCompare(b.name)
    );

    const allJobSkillKeys = new Set();
    let matchedOccurrences = 0;
    let totalOccurrences = 0;
    for (const job of jobs) {
      for (const key of getJobSkills(job).keys()) {
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
        jobsAnalysed: jobs.length,
        jobsScanned: jobs.length,
        totalAvailableJobs: jobs.length,
        matchedSkills: matchedSkills.length,
        missingSkills: missingSkills.length,
        coverage,
        matchedOccurrences,
        totalSkillOccurrences: totalOccurrences,
        missingOccurrences: totalOccurrences - matchedOccurrences,
      },
      matchedSkills,
      missingSkills,
      message: jobs.length
        ? ""
        : "The current Job Search results could not be matched to stored job records. Refresh Job Search and try again.",
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
