const Job = require("../models/Job");
const User = require("../models/User");

// Only recognised technical skills are allowed into the analysis.
// Company names and generic job-description words are deliberately excluded.
const TECHNICAL_SKILLS = new Set([
  "java", "python", "javascript", "typescript", "c", "c++", "c#", "go", "rust", "php", "ruby", "swift", "kotlin", "r", "scala",
  "html", "css", "react", "angular", "vue", "next.js", "nodejs", "express.js", "redux", "tailwind css", "bootstrap", "material ui", "vite", "webpack",
  "spring", "spring boot", "django", "flask", "fastapi", ".net", "asp.net", "laravel",
  "sql", "mysql", "postgresql", "mongodb", "sqlite", "redis", "oracle", "firebase", "dynamodb", "cassandra", "elasticsearch",
  "aws", "azure", "gcp", "docker", "kubernetes", "jenkins", "git", "github", "gitlab", "terraform", "ansible", "linux", "bash", "powershell",
  "kafka", "spark", "hadoop", "airflow", "maven", "gradle", "nginx", "tomcat",
  "machine learning", "deep learning", "artificial intelligence", "nlp", "computer vision", "tensorflow", "pytorch", "scikit-learn", "pandas", "numpy", "matplotlib", "seaborn", "opencv",
  "tableau", "power bi", "excel", "selenium", "cypress", "jest", "junit", "postman", "swagger", "figma", "jira", "vscode", "intellij", "eclipse",
  "rest api", "graphql", "websocket", "oauth", "jwt", "microservices", "oop", "data structures", "algorithms", "ci/cd", "agile", "scrum",
  "firebase", "postgresql", "tailwind css", "html5", "css3", "redux toolkit", "react native", "electron.js", "chart.js",
]);

const clean = (value) => String(value ?? "").trim();

const canonicalSkill = (value) => {
  const skill = clean(value).toLowerCase().replace(/\s+/g, " ").replace(/\s*\.\s*/g, ".");
  const aliases = {
    js: "javascript",
    "javascript es6": "javascript",
    "node.js": "nodejs",
    "node js": "nodejs",
    nodejs: "nodejs",
    "react.js": "react",
    reactjs: "react",
    "mongo db": "mongodb",
    mongo: "mongodb",
    postgres: "postgresql",
    ml: "machine learning",
    ai: "artificial intelligence",
    "artificial intelligence": "artificial intelligence",
    "c sharp": "c#",
    "c plus plus": "c++",
    "apache kafka": "kafka",
    "apache spark": "spark",
    "apache airflow": "airflow",
    "apache hadoop": "hadoop",
    "microsoft azure": "azure",
    "ms azure": "azure",
    "microsoft excel": "excel",
    "visual studio code": "vscode",
    "vs code": "vscode",
    "express": "express.js",
    "express js": "express.js",
    "tailwind": "tailwind css",
    "powerbi": "power bi",
    "scikit learn": "scikit-learn",
    "restful api": "rest api",
  };
  return aliases[skill] || skill;
};

const isUsefulSkill = (value) => {
  const key = canonicalSkill(value);
  return TECHNICAL_SKILLS.has(key);
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

// A role should be compared against the skills stated in the complete listing,
// not only provider-populated skill arrays (which are often empty or incomplete).
const getJobSkills = (job) => {
  const skills = uniqueSkills([
    ...(Array.isArray(job.skills) ? job.skills : []),
    ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
  ]);

  const searchableText = [
    job.title,
    job.description,
    job.requirements,
    job.qualifications,
    job.responsibilities,
  ].map(clean).filter(Boolean).join(" ").toLowerCase();

  for (const skill of TECHNICAL_SKILLS) {
    // Short tokens such as C, R and Go are too ambiguous to extract safely
    // from long descriptions. They are still accepted when explicitly tagged
    // in the job's structured skills arrays above.
    if (skill.length < 3) continue;
    const pattern = escapeRegex(skill).replace(/\\\s+/g, "\\\\s+");
    const matcher = new RegExp("(^|[^a-z0-9])" + pattern + "(?=$|[^a-z0-9])", "i");
    if (matcher.test(searchableText)) {
      const key = canonicalSkill(skill);
      if (!skills.has(key)) skills.set(key, skill);
    }
  }

  return skills;
};

// Exclude unrelated roles when a role-specific term is available. The Job
// Search endpoint already retrieves/ranks against the saved target role; this
// second check prevents generic words such as "developer" from being enough.
const isRelevantToTargetRole = (job, role) => {
  const genericTerms = new Set([
    "developer", "engineer", "software", "programmer", "specialist",
    "analyst", "architect", "intern", "senior", "junior", "associate",
  ]);
  const roleTerms = clean(role).toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((term) => term.length > 2 && !genericTerms.has(term));

  if (!roleTerms.length) return true;

  const title = clean(job.title).toLowerCase();
  const context = [
    title,
    clean(job.description),
    clean(job.requirements),
    clean(job.qualifications),
  ].join(" ").toLowerCase();

  const matchesTerm = (text, term) => {
    const escaped = escapeRegex(term);
    return new RegExp("(^|[^a-z0-9])" + escaped + "(?=$|[^a-z0-9])", "i").test(text);
  };

  // Prefer a role-specific term in the job title. If the title is generic,
  // allow a clear role-specific mention in the listing text.
  return roleTerms.some((term) => matchesTerm(title, term)) ||
    roleTerms.some((term) => matchesTerm(context, term));
};

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
    const retrievedJobs = await Job.find({
      _id: { $in: jobIds },
      $nor: [
        { jobUrl: /jobpulse_id=/i },
        { jobUrl: /linkedin\.com\/jobs\/search/i },
      ],
    })
      .select("title company description requirements qualifications responsibilities skills detectedJobSkills location source scrapedAt jobUrl")
      .lean();

    // Use the currently saved target role for this request, so changing the
    // role and refreshing Job Search produces a new role-specific analysis.
    const jobs = retrievedJobs.filter((job) => isRelevantToTargetRole(job, role));

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

    const rankedMissingSkills = Array.from(skillStats.values()).map((item) => ({
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
      b.requiredCount - a.requiredCount ||
      b.averageRoleRelevance - a.averageRoleRelevance ||
      a.name.localeCompare(b.name)
    );

    // Assign High / Medium / Low by relative rank in this live result set.
    // This avoids fixed score weights and absolute numeric cut-offs.
    const highPriorityEnd = Math.ceil(rankedMissingSkills.length * 0.25);
    const mediumPriorityEnd = Math.ceil(rankedMissingSkills.length * 0.75);
    const missingSkills = rankedMissingSkills.map((skill, index) => ({
      ...skill,
      priority: index < highPriorityEnd
        ? "High"
        : index < mediumPriorityEnd
          ? "Medium"
          : "Low",
    }));

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
    // Dashboard coverage is based on distinct skills, not repeated mentions.
    // Each normalized skill is counted once across the complete analysed job set.
    const totalDistinctJobSkills = allJobSkillKeys.size;
    const coverage = totalDistinctJobSkills
      ? Math.round((matchedSkills.length / totalDistinctJobSkills) * 100)
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
        totalDistinctJobSkills,
        coverage,
        // Retained for optional diagnostics; not used as primary dashboard metrics.
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
