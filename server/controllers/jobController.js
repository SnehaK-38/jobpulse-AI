const axios = require("axios");
const crypto = require("crypto");

const Job = require("../models/Job");
const JobRefreshState = require("../models/JobRefreshState");
const User = require("../models/User");

// ============================================================
// CONFIGURATION
// ============================================================

const PYTHON_API =
  process.env.PYTHON_API ||
  "http://127.0.0.1:8000";

const PYTHON_REFRESH_TIMEOUT =
  Number(
    process.env.PYTHON_REFRESH_TIMEOUT ||
      300000
  );

const PYTHON_RANK_TIMEOUT =
  Number(
    process.env.PYTHON_RANK_TIMEOUT ||
      120000
  );

const DEFAULT_RESULTS_WANTED =
  Number(
    process.env.JOBSPY_RESULTS_WANTED ||
      200
  );

// Maximum number of cached jobs sent to Python in one ranking call.
// This is a performance limit, NOT a job-scope limit.
// Wide retrieval still happens during refresh.
const CACHE_RANK_LIMIT =
  Number(
    process.env.CACHE_RANK_LIMIT ||
      500
  );

const RANK_CACHE_TTL_MS = 30 * 1000;
const RANK_CACHE_MAX_ENTRIES = 8;
const rankCache = new Map();

const JOB_REFRESH_INTERVAL_MS =
  Number(
    process.env.JOB_REFRESH_INTERVAL_MS ||
      process.env.REFRESH_COOLDOWN_MS ||
      24 * 60 * 60 * 1000
  );

const MAX_JOB_AGE_DAYS =
  Number(process.env.MAX_JOB_AGE_DAYS) || 60;

const EXPERIENCE_NUMBER_WORDS = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

const refreshState = new Map();

// ============================================================
// HELPERS
// ============================================================

const cleanString = (value) => {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
};

const cleanArray = (value) => {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((item) =>
        cleanString(item)
      )
      .filter(Boolean);
  }

  return String(value)
    .split(/[,;|\n]+/)
    .map((item) =>
      item.trim()
    )
    .filter(Boolean);
};

const getProfileSearchTerm = (profile = {}) => {
  const explicitRole = cleanString(profile.targetRole);
  if (explicitRole) {
    const role = explicitRole.split(/[|;]/)[0].trim();
    return /^s\.?d\.?e\.?$/i.test(role)
      ? "software engineer"
      : role;
  }

  const resumeHeadline = cleanString(profile.resumeText)
    .split(/\r?\n/)
    .slice(0, 8)
    .find((line) => line.includes("|") && !line.includes("@"));

  if (!resumeHeadline) return "";
  return resumeHeadline
    .split("|")
    .map((part) => part.trim())
    .find((part) => part && !/\b(student|undergrad(?:uate)?)\b/i.test(part)) || "";
};

const normalizeValue = (value) =>
  cleanString(value)
    .toLowerCase()
    .trim();

const canonicalSkillToken = (skill = "") => {
  const token = normalizeValue(skill)
    .replace(/\b(?:react(?:js)?|react\.js)\b/g, "react")
    .replace(/\b(?:node(?:js)?|node\.js)\b/g, "node")
    .replace(/\b(?:javascript|js)\b/g, "javascript")
    .replace(/\b(?:typescript|ts)\b/g, "typescript")
    .replace(/\b(?:html5?|html)\b/g, "html")
    .replace(/\b(?:css3?|css)\b/g, "css")
    .replace(/\b(?:python3?|py)\b/g, "python")
    .replace(/\b(?:c#|csharp)\b/g, "csharp")
    .replace(/\b(?:c\+\+|cpp)\b/g, "cpp")
    .replace(/\d+$/g, "")
    .replace(/[^a-z0-9+#.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return token;
};

const levenshteinDistance = (left, right) => {
  const a = left || "";
  const b = right || "";
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
};

const skillsEquivalent = (left = "", right = "") => {
  const a = canonicalSkillToken(left);
  const b = canonicalSkillToken(right);

  if (!a || !b) {
    return false;
  }

  if (a === b) {
    return true;
  }

  const aliasMap = {
    js: "javascript",
    javascript: "javascript",
    ts: "typescript",
    typescript: "typescript",
    py: "python",
    python: "python",
    css: "css",
    html: "html",
    node: "node",
    react: "react",
  };

  const aAlias = aliasMap[a] || a;
  const bAlias = aliasMap[b] || b;
  if (aAlias === bAlias) {
    return true;
  }

  const maxLength = Math.max(a.length, b.length);
  if (maxLength <= 5) {
    return levenshteinDistance(a, b) <= 1;
  }

  if (Math.abs(a.length - b.length) <= 1) {
    return levenshteinDistance(a, b) <= 2;
  }

  return false;
};

// ============================================================
// NORMALIZE JOB
// ============================================================

const normalizeJobForDatabase = (job) => {
  return {
    ...job,

    title: cleanString(
      job?.title
    ),

    company: cleanString(
      job?.company
    ),

    companyUrl: cleanString(
      job?.companyUrl
    ),

    location: cleanString(
      job?.location
    ),

    description: cleanString(
      job?.description
    ),

    jobType: cleanString(
      job?.jobType ||
        job?.employmentType
    ),

    experience: cleanString(
      job?.experience ||
        job?.experienceLevel ||
        job?.requiredExperience
    ),

    workMode: cleanString(
      job?.workMode
    ),

    skills: cleanArray(
      job?.skills
    ),

    detectedJobSkills: cleanArray(
      job?.detectedJobSkills
    ),

    matchedSkills: [],

    missingSkills: [],

    matchReasons: [],

    matchScore: undefined,

    finalRankingScore:
      undefined,

    searchMatchPercentage:
      undefined,

    semanticProfilePercentage:
      undefined,

    roleMatchPercentage:
      undefined,

    skillMatchPercentage:
      undefined,

    experienceMatchPercentage:
      undefined,

    otherFitPercentage:
      undefined,

    profileMatchPercentage:
      undefined,

    jobRequirementCoverage:
      undefined,

    isRemote: Boolean(
      job?.isRemote
    ),

    postedDate:
      job?.postedDate ||
      job?.created ||
      job?.createdAt ||
      null,

    scrapedAt:
      job?.scrapedAt ||
      new Date().toISOString(),
  };
};

// ============================================================
// USER PROFILE
// ============================================================

const getUserProfile = async (
  userId
) => {
  if (!userId) {
    return {};
  }

  try {
    const user =
      await User.findById(
        userId
      ).lean();

    if (!user) {
      return {};
    }

    return {
      fullName:
        user.fullName ||
        "",

      bio:
        user.bio ||
        "",

      targetRole:
        user.targetRole ||
        "",

      lookingFor:
        user.lookingFor ||
        "",

      preferredLocation:
        user.preferredLocation ||
        "",

      preferredWorkMode:
        user.preferredWorkMode ||
        "",

      expectedSalary:
        user.expectedSalary ||
        "",

      preferredIndustry:
        user.preferredIndustry ||
        "",

      preferredCompanies:
        Array.isArray(
          user.preferredCompanies
        )
          ? user.preferredCompanies
          : [],

      skills:
        Array.isArray(
          user.skills
        )
          ? user.skills
          : [],

      resumeSkills:
        Array.isArray(
          user.resumeSkills
        )
          ? user.resumeSkills
          : [],

      resumeText:
        user.resumeText ||
        "",

      projects:
        Array.isArray(
          user.projects
        )
          ? user.projects
          : [],

      experience:
        Array.isArray(
          user.experience
        )
          ? user.experience
          : [],

      yearsOfExperience:
        user.yearsOfExperience ?? null,

      certifications:
        Array.isArray(
          user.certifications
        )
          ? user.certifications
          : [],

      achievements:
        Array.isArray(
          user.achievements
        )
          ? user.achievements
          : [],

      languagesKnown:
        Array.isArray(
          user.languagesKnown
        )
          ? user.languagesKnown
          : [],

      socialLinks:
        Array.isArray(
          user.socialLinks
        )
          ? user.socialLinks
          : [],

      education:
        Array.isArray(
          user.education
        )
          ? user.education
          : [],
    };
  } catch (error) {
    console.error(
      "getUserProfile error:",
      error.message
    );

    return {};
  }
};

// ============================================================
// EFFECTIVE USER PREFERENCES
// ============================================================

const getEffectiveSearchParams = ({
  searchTerm,
  location,
  jobType,
  workMode,
  profile,
}) => {
  const explicitSearchTerm =
    cleanString(
      searchTerm
    );

  const explicitLocation =
    cleanString(
      location
    );

  const explicitJobType =
    cleanString(
      jobType
    );

  const explicitWorkMode =
    cleanString(
      workMode
    );
  const profileLocation =
    cleanString(
      profile?.preferredLocation
    );

  const profileJobType =
    cleanString(
      profile?.lookingFor
    );

  const profileWorkMode =
    cleanString(
      profile?.preferredWorkMode
    );

  const effectiveLocation =
    explicitLocation || profileLocation;

  const effectiveJobType =
    explicitJobType || profileJobType;

  const effectiveWorkMode =
    explicitWorkMode || profileWorkMode;

  return {
    explicitSearchTerm,

    effectiveLocation,

    effectiveJobType,

    effectiveWorkMode,

    retrievalSearchTerm:
      explicitSearchTerm || cleanString(profile?.targetRole),
  };
};

// ============================================================
// MONGO SEARCH & FILTER QUERY BUILDER
// ============================================================

const buildMongoSearchQuery = ({
  searchTerm = "",
  location = "",
  workMode = "",
  source = "",
  hoursOld = "",
}) => {
  const andClauses = [];

  // 1. Source filter
  const cleanSource = cleanString(source);
  if (cleanSource) {
    andClauses.push({
      source: { $regex: new RegExp(cleanSource, "i") },
    });
  }

  // Job type and work mode are applied after retrieval. Many providers omit
  // these fields, so filtering them in Mongo would discard otherwise valid jobs.

  // Location filter
  const cleanLocation = cleanString(location);
  if (cleanLocation) {
    const locationTerms = cleanLocation.toLowerCase() === "mumbai"
      ? ["mumbai", "bombay", "thane"]
      : [cleanLocation];
    const escapedLocationTerms = locationTerms.map(
      (term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    );
    const requestedWorkMode = normalizeValue(workMode);
    const sourceLocationFallback = {
      sourceSearchLocation: {
        $regex: new RegExp(cleanLocation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      },
    };
    if (["onsite", "on-site", "hybrid"].includes(requestedWorkMode)) {
      sourceLocationFallback.$and = [
        {
          $or: [
            { location: { $exists: false } },
            { location: null },
            { location: "" },
            { location: /^mh(?:,?\s*in)?$/i },
            { location: /^maharashtra(?:\s+india)?$/i },
          ],
        },
        { isRemote: { $ne: true } },
        { workMode: { $not: /remote/i } },
      ];
    }
    const locationConditions = [
      ...escapedLocationTerms.map((term) => ({ location: { $regex: term } })),
      sourceLocationFallback,
    ];
    // Don't let remote jobs consume a location-filtered candidate cap for
    // on-site or hybrid searches.
    if (
      !requestedWorkMode ||
      ["remote", "both", "any", "all"].includes(requestedWorkMode)
    ) {
      locationConditions.push(
        { isRemote: true },
        { workMode: /remote/i }
      );
    }
    andClauses.push({ $or: locationConditions });
  }

  // Date filter
  const cleanHours = cleanString(hoursOld);
  if (cleanHours && !isNaN(Number(cleanHours))) {
    const cutoff = new Date(Date.now() - Number(cleanHours) * 3600 * 1000);
    andClauses.push({
      $or: [
        { postedDate: { $gte: cutoff } },
        { scrapedAt: { $gte: cutoff } },
      ],
    });
  }

  // Search term
  const cleanTerm = cleanString(searchTerm);
  if (cleanTerm) {
    const tokens = cleanTerm.split(/\s+/).filter((t) => t.length >= 2);
    const searchConditions = [
      { title: { $regex: cleanTerm, $options: "i" } },
      { skills: { $in: [new RegExp(cleanTerm, "i")] } },
      { company: { $regex: cleanTerm, $options: "i" } },
      { description: { $regex: cleanTerm, $options: "i" } },
    ];
    for (const tok of tokens) {
      searchConditions.push({ title: { $regex: tok, $options: "i" } });
      searchConditions.push({ skills: { $in: [new RegExp(tok, "i")] } });
    }
    andClauses.push({ $or: searchConditions });
  }

  if (andClauses.length === 1) {
    return andClauses[0];
  } else if (andClauses.length > 1) {
    return { $and: andClauses };
  }

  return {};
};

// ============================================================
// IN-CONTROLLER FALLBACK RANKING SCORER
// ============================================================

const fallbackScoreJob = (job, { searchTerm = "", profile = {} }) => {
  const query = cleanString(searchTerm).toLowerCase();
  const title = cleanString(job.title).toLowerCase();
  const company = cleanString(job.company).toLowerCase();
  const desc = cleanString(job.description).toLowerCase();
  const skills = Array.isArray(job.skills) ? job.skills.map((s) => cleanString(s).toLowerCase()) : [];
  const jobText = `${title} ${company} ${desc} ${skills.join(" ")}`;
  const profileSkills = [...new Set([
    ...(Array.isArray(profile?.skills) ? profile.skills : []),
    ...(Array.isArray(profile?.resumeSkills) ? profile.resumeSkills : []),
  ].map((s) => cleanString(s).toLowerCase()).filter(Boolean))];
  const resumeText = cleanString(profile?.resumeText);
  const experienceValue = profile?.yearsOfExperience ?? profile?.experienceLevel ?? profile?.experience;
  const experienceText = cleanString(experienceValue);
  const resumeHeadline = resumeText.split(/\r?\n/).slice(0, 8)
    .find((line) => line.includes("|") && !line.includes("@")) || "";
  const roleText = cleanString(profile?.targetRole) || resumeHeadline;
  const roleOptions = roleText.split(/[|;]/).map((value) => value.trim()).filter(Boolean);
  const containsTerm = (text, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Boolean(escaped && new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text));
  };

  let searchScore = 50;
  let searchRelevant = false;

  if (query) {
    if (title.includes(query)) {
      searchScore = 95;
      searchRelevant = true;
    } else if (skills.some((s) => s.includes(query) || query.includes(s))) {
      searchScore = 85;
      searchRelevant = true;
    } else if (company.includes(query)) {
      searchScore = 80;
      searchRelevant = true;
    } else {
      const qTokens = query.split(/\s+/).filter((t) => t.length >= 2);
      const matches = qTokens.filter((t) => title.includes(t) || skills.some((s) => s.includes(t)) || company.includes(t));
      if (matches.length > 0) {
        searchScore = Math.round(50 + (matches.length / qTokens.length) * 40);
        searchRelevant = true;
      }
    }
  } else {
    searchRelevant = true;
    searchScore = 80;
  }

  // Skill match
  const matchedSkills = [];
  const jobSkillTokens = new Set(
    jobText
      .split(/\s+/)
      .map((token) => canonicalSkillToken(token))
      .filter(Boolean)
  );
  for (const ps of profileSkills) {
    const profileSkill = canonicalSkillToken(ps);
    const isSkillMatch =
      containsTerm(jobText, ps) ||
      [...jobSkillTokens].some((token) => skillsEquivalent(token, profileSkill)) ||
      skillsEquivalent(ps, jobText);

    if (isSkillMatch) {
      matchedSkills.push(ps);
    }
  }
  const profileSkillSet = new Set(profileSkills);
  const missingSkills = [...new Set(skills.filter((skill) => !profileSkillSet.has(skill)))];
  const skillScore = profileSkills.length > 0 ? Math.round((matchedSkills.length / profileSkills.length) * 100) : 0;

  // Role match
  const roleScore = Math.max(0, ...roleOptions.map((candidate) => {
    const rTokens = candidate.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (!rTokens.length) return 0;
    const titleMatches = rTokens.filter((token) => containsTerm(title, token)).length;
    return Math.round((titleMatches / rTokens.length) * 100);
  }));

  const profileRelevant = roleScore >= 50 || matchedSkills.length >= 2;
  const resumeTokens = [...new Set(resumeText.toLowerCase().match(/[a-z0-9+#.]{4,}/g) || [])];
  const contextMatches = resumeTokens.filter((token) => jobText.includes(token)).length;
  const contextScore = resumeTokens.length ? contextMatches / resumeTokens.length * 100 : 0;
  const hasResumeContext = Boolean(resumeText || profileSkills.length || roleText);

  const profileYearsMatch = experienceText.match(
    /(\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:years?|yrs?)/i
  );
  const profileYears = Number.isFinite(experienceValue)
    ? experienceValue
    : profileYearsMatch
      ? Number(profileYearsMatch[1])
      : /\b(fresher|no experience|entry.level|0 years?)\b/i.test(experienceText)
        ? 0
        : null;
  const jobYears = Number(jobText.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i)?.[1] || 0);
  const mentionsExperience = /\d+\s*\+?\s*(?:years?|yrs?)/i.test(jobText);
  const isEntryLevelJob = /intern|internship|fresher|entry.level|graduate|trainee/i.test(`${title} ${desc}`);
  const experienceScore = mentionsExperience
    ? (profileYears === null
      ? 50
      : profileYears >= jobYears
        ? 100
        : Math.max(0, 100 - (jobYears - profileYears) * 25))
    : (isEntryLevelJob || profileYears !== null ? 100 : 60);

  // Final ranking score
  const finalRankingScore = Math.round(
    experienceScore * 0.3 + roleScore * 0.3 + skillScore * 0.25 + contextScore * 0.15
  );

  const matchReasons = [];
  if (query && searchRelevant) matchReasons.push(`Matches search query "${searchTerm}"`);
  if (matchedSkills.length > 0) matchReasons.push(`Matches ${matchedSkills.length} of your skills (${matchedSkills.slice(0, 3).join(", ")})`);
  if (roleScore >= 35) matchReasons.push("The job aligns with a role or focus area in your profile.");
  if (job.workMode) matchReasons.push(`Work mode: ${job.workMode}`);

  return {
    ...job,
    finalRankingScore: Math.min(100, Math.max(0, finalRankingScore)),
    matchScore: Math.min(100, Math.max(0, finalRankingScore)),
    searchMatchPercentage: searchScore,
    skillMatchPercentage: skillScore,
    roleMatchPercentage: roleScore,
    experienceMatchPercentage: experienceScore,
    semanticProfilePercentage: Math.round((skillScore + roleScore + contextScore) / 3),
    jobRequirementCoverage: Math.max(skillScore, 65),
    searchRelevant,
    profileRelevant: !hasResumeContext || profileRelevant,
    matchedSkills,
    missingSkills,
    matchReasons,
  };
};

const jobQualityText = (job = {}) => [
  job?.title,
  job?.description,
  job?.requirements,
  job?.qualifications,
  job?.experience,
  job?.experienceLevel,
  job?.jobDescription,
].filter(Boolean).join(" ");

const isLeadershipOrSeniorRole = (job = {}) => {
  const title = cleanString(job.title);
  const text = jobQualityText(job);
  if (/\b(?:senior|staff|principal|director|manager|head|vp|vice\s+president|chief)\b/i.test(title)) {
    return true;
  }
  return /\b(?:team\s+lead|tech\s+lead|engineering\s+lead|product\s+lead|design\s+lead|lead(?:er|ership)?|department\s+lead)\b/i.test(text);
};

const fallbackExperienceMatches = (job, profile = {}) => {
  const profileExperience = profile?.yearsOfExperience ??
    profile?.experienceLevel ??
    profile?.experience;
  const normalizeYearWords = (value) => cleanString(value)
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b(?=\s*(?:to|-)\s*(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*(?:years?|yrs?))/gi,
      (word) => EXPERIENCE_NUMBER_WORDS[word.toLowerCase()]
    )
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b(?=\s*(?:years?|yrs?))/gi,
      (word) => EXPERIENCE_NUMBER_WORDS[word.toLowerCase()]
    );
  const profileText = normalizeYearWords(
    typeof profileExperience === "string"
      ? profileExperience
      : Array.isArray(profileExperience)
        ? profileExperience.join(" ")
      : ""
  );
  const profileYearsMatch = profileText.match(/(\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:years?|yrs?)/i);
  let profileYears = Number.isFinite(profileExperience)
    ? profileExperience
    : profileYearsMatch
      ? Number(profileYearsMatch[1])
      : null;
  if (profileYears === null && /^\s*\d+(?:\.\d+)?\s*$/.test(profileText)) {
    profileYears = Number(profileText);
  }

  if (profileYears === null && Array.isArray(profileExperience)) {
    const intervals = profileExperience
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const start = new Date(entry.startDate || entry.start || entry.from);
        const end = new Date(entry.endDate || entry.end || entry.to || Date.now());
        return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
          ? null
          : [Math.min(start.getTime(), end.getTime()), Math.max(start.getTime(), end.getTime())];
      })
      .filter(Boolean)
      .sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const previous = merged[merged.length - 1];
      if (previous && interval[0] <= previous[1]) {
        previous[1] = Math.max(previous[1], interval[1]);
      } else {
        merged.push([...interval]);
      }
    }
    if (merged.length) {
      profileYears = merged.reduce((total, [start, end]) => total + end - start, 0) /
        (365.25 * 24 * 60 * 60 * 1000);
    }
  }

  if (
    profileYears === null &&
    /\b(fresher|no experience|entry.level|0 years?)\b/i.test(profileText)
  ) profileYears = 0;

  const experienceField = cleanString(
    job?.experience || job?.experienceLevel || job?.requiredExperience
  );
  const structuredExperience = job?.experience ?? job?.experienceLevel ?? job?.requiredExperience;
  const structuredMinYears = job?.minExperienceYears == null || job.minExperienceYears === ""
    ? null
    : Number(job.minExperienceYears);
  const structuredMaxYears = job?.maxExperienceYears == null || job.maxExperienceYears === ""
    ? null
    : Number(job.maxExperienceYears);
  const requirementText = normalizeYearWords(jobQualityText(job));
  if (isLeadershipOrSeniorRole(job)) return false;
  if (/\b(?:freshers?|entry\.level|intern(ship)?|trainee|apprentice|new\s+grad)\b/i.test(requirementText)) {
    return false;
  }
  const isFresherRequirement = /\b(?:freshers?|entry.level|intern(ship)?|trainee|apprentice|new grad)\b/i.test([
    job?.title,
    requirementText,
  ].filter(Boolean).join(" "));
  const range = requirementText.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)(?:\s*(?:of\s+)?(?:relevant\s+|professional\s+|work\s+)?experience)?/i);
  const upTo = requirementText.match(/\b(?:up\s+to|at\s+most|maximum(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\b/i);
  const plus = requirementText.match(/(?:\b(?:at\s+least|minimum(?:\s+of)?)\s+)?(\d+(?:\.\d+)?)\s*(?:\+|plus)\s*(?:years?|yrs?)/i);
  const exactField = experienceField.match(/^\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s*$/i);
  const single = requirementText.match(/(?:\b(?:at\s+least|minimum(?:\s+of)?)\s+)?(\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:[A-Za-z-]+\s+){0,5}(?:experience|exp)\b/i);
  const reverseSingle = requirementText.match(
    /\b(?:experience|exp)\s+(?:of\s+|with\s+)?(\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:years?|yrs?)\b|\b(?:experience|exp)\b[^.!?\n]{0,80}?\b(?:for|spanning)\s+(\d+(?:\.\d+)?)\s*(?:\+|plus)?\s*(?:years?|yrs?)\b/i
  );

  let minYears = null;
  let maxYears = null;
  let inferredFresherRequirement = false;
  let allowsUnknownProfileExperience = false;
  if (Number.isFinite(structuredMinYears) || Number.isFinite(structuredMaxYears)) {
    minYears = Number.isFinite(structuredMinYears) ? structuredMinYears : null;
    maxYears = Number.isFinite(structuredMaxYears) ? structuredMaxYears : null;
  } else if (range) {
    minYears = Number(range[1]);
    maxYears = Number(range[2]);
  } else if (upTo) {
    maxYears = Number(upTo[1]);
  } else if (plus) {
    minYears = Number(plus[1]);
  } else if (exactField) {
    minYears = Number(exactField[1]);
    maxYears = minYears;
  } else if (Number.isFinite(structuredExperience)) {
    minYears = structuredExperience;
    maxYears = structuredExperience;
  } else if (/^\s*\d+(?:\.\d+)?\s*$/.test(experienceField)) {
    minYears = Number(experienceField);
    maxYears = minYears;
  } else if (single || reverseSingle) {
    minYears = Number(single ? single[1] : reverseSingle[1] || reverseSingle[2]);
  } else if (/\b(?:no|without)\s+(?:prior\s+|previous\s+|any\s+)?(?:work\s+)?experience\s+(?:is\s+)?(?:required|necessary|needed)\b/i.test(requirementText)) {
    minYears = 0;
    allowsUnknownProfileExperience = true;
    if (isFresherRequirement) {
      maxYears = 2;
      inferredFresherRequirement = true;
    }
  } else if (isFresherRequirement) {
    minYears = 0;
    maxYears = 2;
    inferredFresherRequirement = true;
    allowsUnknownProfileExperience = true;
  }

  if (Number.isFinite(minYears) && minYears < 5) return false;
  if (Number.isFinite(maxYears) && maxYears < 5) return false;
  if (minYears === null && maxYears === null) return true;
  if (profileYears === null) return allowsUnknownProfileExperience;

  const experienceTolerance = (() => {
    if (inferredFresherRequirement) {
      return 0;
    }
    if (Number.isFinite(minYears) && Number.isFinite(maxYears) && maxYears >= minYears) {
      return Math.max(1, Math.min(2, Math.ceil((maxYears - minYears) / 2)));
    }
    if (Number.isFinite(minYears)) {
      return Math.max(1, Math.min(2, Math.ceil(minYears / 3)));
    }
    if (Number.isFinite(maxYears)) {
      return Math.max(1, Math.min(2, Math.ceil(maxYears / 3)));
    }
    return 1;
  })();

  const lowerBound = Number.isFinite(minYears)
    ? minYears - experienceTolerance
    : -Infinity;
  const upperBound = Number.isFinite(maxYears)
    ? maxYears + experienceTolerance
    : Infinity;

  return profileYears >= lowerBound && profileYears <= upperBound;
};

const fallbackJobIsRecent = (job, hoursOld = "") => {
  const postedDate = job?.postedDate ? new Date(job.postedDate) : null;
  const scrapedAt = job?.scrapedAt ? new Date(job.scrapedAt) : null;
  const referenceDate = postedDate && !Number.isNaN(postedDate.getTime())
    ? postedDate
    : scrapedAt && !Number.isNaN(scrapedAt.getTime())
      ? scrapedAt
      : null;

  if (!referenceDate) return true;

  const requestedHours = Number(hoursOld);
  const ageLimitMs = Math.min(
    MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000,
    Number.isFinite(requestedHours) && requestedHours > 0
      ? requestedHours * 60 * 60 * 1000
      : Infinity
  );
  const ageMs = Date.now() - referenceDate.getTime();

  return ageMs >= -48 * 60 * 60 * 1000 && ageMs <= ageLimitMs;
};

const fallbackJobMeetsFilters = (job, {
  location = "",
  jobType = "",
  workMode = "",
  hoursOld = "",
  profile = {},
}) => {
  if (!fallbackJobIsRecent(job, hoursOld)) return false;

  const text = `${cleanString(job.title)} ${cleanString(job.jobType)} ${cleanString(job.description)}`.toLowerCase();
  const mode = cleanString(workMode).toLowerCase();
  const anyWorkMode = ["both", "any", "all"].includes(mode);
  const remote = Boolean(job.isRemote) || /\bremote\b/i.test(`${job.workMode || ""} ${job.location || ""} ${job.description || ""}`);
  const hybrid = /\bhybrid\b/i.test(`${job.workMode || ""} ${job.description || ""}`);
  const onsite = /\b(on.?site|in.?office)\b/i.test(`${job.workMode || ""} ${job.description || ""}`);
  if (!anyWorkMode && mode === "remote" && !remote) return false;
  if (!anyWorkMode && mode === "hybrid" && (remote || onsite)) return false;
  if (!anyWorkMode && ["onsite", "on-site", "on site"].includes(mode) && (remote || hybrid)) return false;

  const preferredLocation = cleanString(location).toLowerCase();
  if (preferredLocation && !remote && !cleanString(job.location).toLowerCase().includes(preferredLocation)) return false;

  const type = cleanString(jobType).toLowerCase().replace(/[-_ ]/g, "");
  if (type && type !== "both") {
    const providerType = cleanString(job.jobType || job.employmentType).toLowerCase();
    if (type === "fulltime") {
      const normalizedProviderType = providerType.replace(/[-_ ]/g, "");
      const title = cleanString(job.title);
      const explicitlyOtherType =
        /intern|parttime|contract|temporary|trainee|apprentice|coop/.test(normalizedProviderType);
      const titleIndicatesOtherType =
        /intern(ship)?|trainee|apprentice|co.?op|part[- ]time|contract(or)?|temporary/i.test(title);
      if (
        explicitlyOtherType ||
        titleIndicatesOtherType
      ) return false;
    } else {
      const text = `${cleanString(job.title)} ${providerType} ${cleanString(job.description)}`.toLowerCase();
      const actualType = /intern/.test(text) ? "internship"
        : /part.?time/.test(text) ? "parttime"
          : /contract/.test(text) ? "contract" : "";
      if (actualType && actualType !== type) return false;
    }
  }
  if (!fallbackExperienceMatches(job, profile)) return false;
  return true;
};

// ============================================================
// SOURCE FILTER AFTER RETRIEVAL
// ============================================================

const sourceMatches = (
  source,
  requestedSource
) => {
  const requested =
    cleanString(
      requestedSource
    );

  if (!requested) {
    return true;
  }

  const actual =
    normalizeValue(
      source
    );

  const requestedValues =
    cleanArray(
      requested
    );

  if (
    requestedValues.length === 0
  ) {
    return true;
  }

  return requestedValues.some(
    (value) => {
      const normalized =
        normalizeValue(
          value
        );

      return (
        actual === normalized ||
        actual.includes(
          normalized
        ) ||
        normalized.includes(
          actual
        )
      );
    }
  );
};

const filterJobsBySource = (
  jobs,
  source
) => {
  if (!Array.isArray(jobs)) {
    return [];
  }

  if (!cleanString(source)) {
    return jobs;
  }

  return jobs.filter(
    (job) =>
      sourceMatches(
        job?.source,
        source
      )
  );
};

// ============================================================
// SAVE SCRAPED JOBS
// ============================================================

const saveScrapedJobs = async (
  jobs
) => {
  if (!Array.isArray(jobs)) {
    return {
      saved: 0,
      duplicates: 0,
    };
  }

  let saved = 0;
  let duplicates = 0;

  for (const rawJob of jobs) {
    const job = {
      ...normalizeJobForDatabase(rawJob),
      scrapedAt: new Date(),
    };

    const uniqueUrl =
      cleanString(
        job.jobUrl ||
          job.sourceUrl ||
          job.applicationUrl ||
          job.jobUrlDirect
      );

    try {
      if (uniqueUrl) {
        await Job.findOneAndUpdate(
          {
            jobUrl:
              uniqueUrl,
          },
          {
            $set: {
              ...job,

              jobUrl:
                uniqueUrl,

              matchedSkills: [],

              missingSkills: [],

              matchReasons: [],

              matchScore:
                undefined,

              finalRankingScore:
                undefined,

              searchMatchPercentage:
                undefined,

              semanticProfilePercentage:
                undefined,

              roleMatchPercentage:
                undefined,

              skillMatchPercentage:
                undefined,

              experienceMatchPercentage:
                undefined,

              otherFitPercentage:
                undefined,

              profileMatchPercentage:
                undefined,

              jobRequirementCoverage:
                undefined,
            },
          },
          {
            upsert: true,
            returnDocument: "after",
            setDefaultsOnInsert:
              true,
          }
        );
      } else {
        await Job.create(
          job
        );
      }

      saved++;
    } catch (error) {
      if (
        error?.code === 11000
      ) {
        duplicates++;
      } else {
        console.error(
          "Failed to save scraped job:",
          error.message
        );
      }
    }
  }

  return {
    saved,
    duplicates,
  };
};

// ============================================================
// PYTHON WIDE REFRESH
// ============================================================
//
// IMPORTANT:
//
// Refreshes cache recently posted, source-eligible jobs broadly. User
// preferences are applied later during ranking so a narrow search does not
// prevent other fresh jobs from being cached.
// ============================================================

const refreshJobsNow = async ({
  source,
  searchTerm = "",
  location = "",
  jobType = "",
  workMode = "",
  hoursOld = null,
  resultsWanted = DEFAULT_RESULTS_WANTED,
  profile = {},
} = {}) => {
  try {
    console.log(
      "\n🌐 Starting WIDE Python refresh..."
    );

    const response =
      await axios.post(
        `${PYTHON_API}/refresh`,
        {
          search_term: cleanString(searchTerm),

          location: cleanString(location),

          job_type: cleanString(jobType),

          work_mode: cleanString(workMode),

          hours_old: hoursOld ? Number(hoursOld) : null,

          sites: source || null,

          results_wanted:
            resultsWanted,

          profile:
            profile || {},
        },
        {
          timeout:
            PYTHON_REFRESH_TIMEOUT,
        }
      );

    let jobs =
      Array.isArray(
        response.data?.jobs
      )
        ? response.data.jobs
        : [];

    jobs =
      filterJobsBySource(
        jobs,
        source
      );

    const sourceSummary =
      jobs.reduce(
        (
          summary,
          job
        ) => {
          const jobSource =
            cleanString(
              job?.source
            ) ||
            "Unknown";

          summary[
            jobSource
          ] =
            (
              summary[
                jobSource
              ] ||
              0
            ) + 1;

          return summary;
        },
        {}
      );

    console.log(
      "Python provider results:",
      response.data?.providerSummary || "not provided by Python service"
    );

    const providerSummary = Object.fromEntries(
      Object.entries(response.data?.providerSummary || {}).map(
        ([provider, summary]) => [
          provider,
          {
            success: Boolean(summary?.success),
            count: Number(summary?.count) || 0,
            error: summary?.error || null,
          },
        ]
      )
    );

    const saveResult =
      await saveScrapedJobs(
        jobs
      );

    console.log(
      `✅ Wide refresh completed | jobs=${jobs.length} | saved=${saveResult.saved} | duplicates=${saveResult.duplicates} | sources=${JSON.stringify(sourceSummary)}`
    );

    return {
      jobs,

      sourceSummary,
      providerSummary,

      saved:
        saveResult.saved,

      duplicates:
        saveResult.duplicates,
    };
  } catch (error) {
    console.error(
      "Python wide refresh failed:",
      error.message
    );

    throw error;
  }
};

// ============================================================
// BACKGROUND REFRESH
// ============================================================

const refreshJobsInBackground =
  async ({
    searchTerm,
    location,
    jobType,
    workMode,
    hoursOld,
    source,
    resultsWanted,
    profile,
  }) => {
    const key = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          "job-cache-v2",
          cleanString(searchTerm),
          cleanString(location),
          cleanString(jobType),
          cleanString(workMode),
          cleanString(hoursOld),
          cleanString(source),
        ])
      )
      .digest("hex");

    const now =
      Date.now();

    const previous =
      refreshState.get(
        key
      );

    if (
      previous?.running
    ) {
      return {
        skipped: true,
        refreshing: true,
        promise: previous.promise,
      };
    }

    if (
      previous?.finishedAt &&
      now -
        previous.finishedAt <
        JOB_REFRESH_INTERVAL_MS
    ) {
      return {
        skipped: true,
        providerSummary: previous.providerSummary || {},
      };
    }

    let persistedRefresh;
    try {
      persistedRefresh = await JobRefreshState.findOne({
        refreshKey: key,
        lastRefreshedAt: {
          $gte: new Date(now - JOB_REFRESH_INTERVAL_MS),
        },
      }).lean();
    } catch (error) {
      console.error("Unable to read job refresh cache:", error.message);
    }

    if (persistedRefresh) {
      refreshState.set(key, {
        running: false,
        finishedAt: new Date(persistedRefresh.lastRefreshedAt).getTime(),
        providerSummary: persistedRefresh.providerSummary || {},
      });
      return {
        skipped: true,
        providerSummary: persistedRefresh.providerSummary || {},
      };
    }

    const currentRefresh = refreshState.get(key);
    if (currentRefresh?.running) {
      return {
        skipped: true,
        refreshing: true,
        promise: currentRefresh.promise,
      };
    }

    if (
      currentRefresh?.finishedAt &&
      now - currentRefresh.finishedAt < JOB_REFRESH_INTERVAL_MS
    ) {
      return {
        skipped: true,
        providerSummary: currentRefresh.providerSummary || {},
      };
    }

    if (currentRefresh?.retryAfter && now < currentRefresh.retryAfter) {
      return { skipped: true };
    }

    const refreshPromise = refreshJobsNow({
        source,
        searchTerm,
        location,
        jobType,
        workMode,
        hoursOld,
        resultsWanted,
        profile,
      })
      .then((result) => ({ ok: true, result }))
      .catch((error) => {
        console.error("Job refresh failed:", error.message);
        return { ok: false, error };
      })
      .then(async (result) => {
        if (result?.ok) {
          try {
            await JobRefreshState.findOneAndUpdate(
              { refreshKey: key },
              {
                $set: {
                  lastRefreshedAt: new Date(),
                  providerSummary: result.result?.providerSummary || {},
                },
              },
              { upsert: true }
            );
          } catch (error) {
            console.error("Unable to persist job refresh cache:", error.message);
          }
          refreshState.set(key, {
            running: false,
            finishedAt: Date.now(),
            providerSummary:
              result.result?.providerSummary || {},
          });
        } else {
          refreshState.set(key, {
            running: false,
            retryAfter: Date.now() + 30000,
          });
        }
        return result;
      });

    refreshState.set(key, {
      running: true,
      startedAt: now,
      promise: refreshPromise,
    });

    return {
      started: true,
      refreshing: true,
      promise: refreshPromise,
    };
  };

// ============================================================
// RANK JOBS THROUGH PYTHON
// ============================================================

const rankJobsWithPython =
  async ({
    jobs,
    searchTerm,
    location,
    jobType,
    workMode,
    profile,
  }) => {
    if (
      !Array.isArray(jobs) ||
      jobs.length === 0
    ) {
      return {
        jobs: [],
        sourceSummary: {},
      };
    }

    const cacheKey = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          searchTerm: cleanString(searchTerm),
          location: cleanString(location),
          jobType: cleanString(jobType),
          workMode: cleanString(workMode),
          profile: profile || {},
          jobs: jobs.map((job) => [
            String(
              job?._id ||
                job?.jobUrl ||
                job?.applicationUrl ||
                ""
            ),
            cleanString(job?.scrapedAt),
          ]),
        })
      )
      .digest("hex");
    const cachedRank = rankCache.get(cacheKey);
    if (cachedRank && cachedRank.expiresAt > Date.now()) {
      console.log("Using short-lived cached Python ranking");
      return cachedRank.result;
    }
    if (cachedRank) {
      rankCache.delete(cacheKey);
    }

    console.log(
      `🤖 Sending ${jobs.length} jobs to Python /rank`
    );

    const response =
      await axios.post(
        `${PYTHON_API}/rank`,
        {
          search_term:
            cleanString(
              searchTerm
            ),

          location:
            cleanString(
              location
            ),

          job_type:
            cleanString(
              jobType
            ),

          work_mode:
            cleanString(
              workMode
            ),

          profile:
            profile || {},

          jobs,
        },
        {
          timeout:
            PYTHON_RANK_TIMEOUT,
        }
      );

    const rankedJobs =
      Array.isArray(
        response.data?.jobs
      )
        ? response.data.jobs
        : [];

    console.log(
      "Python ranking diagnostics:",
      response.data?.rankingDiagnostics || "not provided by Python service"
    );

    const result = {
      jobs:
        rankedJobs,

      sourceSummary:
        response.data
          ?.sourceSummary ||
        {},

      rankingDiagnostics:
        response.data?.rankingDiagnostics || {},
    };

    rankCache.set(cacheKey, {
      expiresAt: Date.now() + RANK_CACHE_TTL_MS,
      result,
    });
    while (rankCache.size > RANK_CACHE_MAX_ENTRIES) {
      rankCache.delete(rankCache.keys().next().value);
    }

    return result;
  };

const fetchSearchCandidates = async (
  mongoQuery,
  limit = CACHE_RANK_LIMIT,
  jobModel = Job
) => {
  const candidateLimit = Math.max(1, Math.floor(limit));
  const sources = [
    ...new Set(
      (await jobModel.distinct("source", mongoQuery))
        .map((source) => normalizeValue(source))
        .filter(Boolean)
    ),
  ];

  if (sources.length <= 1) {
    return jobModel.find(mongoQuery)
      .sort({ scrapedAt: -1 })
      .limit(candidateLimit)
      .lean();
  }

  const perSourceLimit = Math.max(
    1,
    Math.ceil(candidateLimit / sources.length)
  );
  const sourceResults = await Promise.all(
    sources.map((source) =>
      jobModel.find({
        $and: [
          mongoQuery,
          {
            source: {
              $regex: new RegExp(
                `^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                "i"
              ),
            },
          },
        ],
      })
        .sort({ scrapedAt: -1 })
        .limit(perSourceLimit)
        .lean()
    )
  );
  const candidates = sourceResults.flat();

  if (candidates.length < candidateLimit) {
    const remaining = await jobModel.find({
      $and: [
        mongoQuery,
        {
          _id: {
            $nin: candidates.map((job) => job._id),
          },
        },
      ],
    })
      .sort({ scrapedAt: -1 })
      .limit(candidateLimit - candidates.length)
      .lean();
    candidates.push(...remaining);
  }

  return candidates
    .sort(
      (left, right) =>
        new Date(right.scrapedAt || 0).getTime() -
        new Date(left.scrapedAt || 0).getTime()
    )
    .slice(0, candidateLimit);
};

// ============================================================
// SEARCH JOBS
// ============================================================

const searchJobs = async (
  req,
  res
) => {
  try {
    const searchTerm =
      cleanString(
        req.query.search_term ??
          req.query.searchTerm
      );

    const location =
      cleanString(
        req.query.location
      );

    const jobType = cleanString(
      req.query.job_type ??
        req.query.jobType
    );

    const workMode = cleanString(
      req.query.work_mode ??
        req.query.workMode
    );

    const hoursOld = cleanString(
      req.query.hours_old ??
        req.query.hoursOld
    );

    const source = cleanString(
      req.query.sites ??
        req.query.source
    );

    const hasSearchTerm = Boolean(searchTerm.trim());
    const hasSearchInputs = Boolean(
      searchTerm.trim() ||
        location.trim() ||
        jobType.trim() ||
        workMode.trim() ||
        source.trim() ||
        hoursOld.trim()
    );

    const requestedResults =
      Number(
        req.query.results_wanted ??
          req.query.resultsWanted ??
          DEFAULT_RESULTS_WANTED
      );

    const resultsWanted =
      Number.isFinite(
        requestedResults
      ) &&
      requestedResults > 0
        ? Math.floor(
            requestedResults
          )
        : DEFAULT_RESULTS_WANTED;

    console.log(
      "\n========================================"
    );

    console.log(
      "🔎 JOB SEARCH"
    );

    console.log(
      "========================================"
    );

    console.log(
      "Search term:",
      searchTerm
    );

    console.log(
      "Location:",
      location
    );

    console.log(
      "Job type:",
      jobType
    );

    console.log(
      "Work mode:",
      workMode
    );

    console.log(
      "Hours old:",
      hoursOld
    );

    console.log(
      "Source:",
      source
    );

    console.log(
      "Results wanted:",
      resultsWanted
    );

    // ========================================================
    // USER
    // ========================================================

    const userId =
      req.user?._id ||
      req.user?.id ||
      req.user?.userId;

    const profile =
      await getUserProfile(
        userId
      );

    // ========================================================
    // EFFECTIVE PROFILE PARAMETERS
    // ========================================================

    const effective =
      getEffectiveSearchParams({
        searchTerm,
        location,
        jobType,
        workMode,
        profile,
      });
    const rankingProfile = profile;

    console.log(
      "Effective location:",
      effective.effectiveLocation
    );

    console.log(
      "Effective job type:",
      effective.effectiveJobType
    );

    console.log(
      "Effective work mode:",
      effective.effectiveWorkMode
    );

    console.log(
      "Starting intelligent job search..."
    );

    // ========================================================
    // STEP 1: INTELLIGENT MONGO RETRIEVAL
    // ========================================================

    const retrievalLocation = effective.effectiveLocation;
    const retrievalJobType = effective.effectiveJobType;
    const retrievalWorkMode = effective.effectiveWorkMode;
    // When the user has not entered a manual query, use their saved target
    // role for Mongo retrieval and ranking instead of searching all cached jobs.
    const roleAwareSearchTerm = searchTerm || effective.retrievalSearchTerm;

    const mongoQuery = buildMongoSearchQuery({
      searchTerm: roleAwareSearchTerm,
      location: retrievalLocation,
      workMode: retrievalWorkMode,
      source,
      hoursOld,
    });

    console.log("Mongo query:", JSON.stringify(mongoQuery));

    let candidates = await fetchSearchCandidates(mongoQuery);
    const retrievedCandidateCount = candidates.length;
    candidates = candidates.filter((job) =>
      fallbackExperienceMatches(job, profile)
    );

    console.log(
      "Experience-eligible Mongo candidates:",
      candidates.length,
      "of",
      retrievedCandidateCount
    );

    // Refresh providers with the same eligibility preferences, and target
    // LinkedIn/Indeed with the
    // user's main resume role, preferred location, and preferred job type.
    let refreshResult = await refreshJobsInBackground({
      searchTerm: effective.retrievalSearchTerm,
      location: retrievalLocation,
      jobType: retrievalJobType,
      workMode: retrievalWorkMode,
      hoursOld: hoursOld || null,
      source,
      resultsWanted,
      profile,
    });

    const providerSummary =
      refreshResult?.result?.providerSummary ||
      refreshResult?.providerSummary ||
      {};

    // ========================================================
    // STEP 2: AI / PYTHON RANKING WITH IN-NODE RESILIENT FALLBACK
    // ========================================================

    let ranked = [];
    let sourceSummary = {};
    let pythonRankingSucceeded = false;
    let rankingDiagnostics = {};

    if (candidates.length > 0) {
      try {
        let rankedCached = await rankJobsWithPython({
          jobs: candidates,
          searchTerm: roleAwareSearchTerm,
          location: retrievalLocation,
          jobType: retrievalJobType,
          workMode: retrievalWorkMode,
          profile: rankingProfile,
        });
        ranked = Array.isArray(rankedCached.jobs) ? rankedCached.jobs : [];
        pythonRankingSucceeded = true;
        sourceSummary = rankedCached.sourceSummary || {};
        rankingDiagnostics = rankedCached.rankingDiagnostics || {};
        console.log("Python ranked jobs returned:", ranked.length);

        if (
          ranked.length === 0 &&
          Number(rankedCached.rankingDiagnostics?.hardFilters?.too_old) > 0
        ) {
          console.log("Cached jobs are stale; checking refresh cooldown.");
          const staleRefresh = await refreshJobsInBackground({
            searchTerm: effective.retrievalSearchTerm,
            location: retrievalLocation,
            jobType: retrievalJobType,
            workMode: retrievalWorkMode,
            hoursOld: hoursOld || null,
            source,
            resultsWanted,
            profile,
          });

          if (staleRefresh?.promise) {
            refreshResult = await staleRefresh.promise;
            candidates = (await fetchSearchCandidates(mongoQuery)).filter((job) =>
              fallbackExperienceMatches(job, profile)
            );

            if (candidates.length > 0) {
              rankedCached = await rankJobsWithPython({
                jobs: candidates,
                searchTerm,
                location: retrievalLocation,
                jobType: retrievalJobType,
                workMode: retrievalWorkMode,
                profile: rankingProfile,
              });
              ranked = Array.isArray(rankedCached.jobs) ? rankedCached.jobs : [];
              sourceSummary = rankedCached.sourceSummary || {};
              rankingDiagnostics = rankedCached.rankingDiagnostics || {};
              console.log("Python ranked jobs after refresh:", ranked.length);
            }
          }
        }
      } catch (pyErr) {
        console.warn("Python /rank failed or timed out. Using in-node fast ranking:", pyErr.message);
      }
    }

    // Keep Python's zero-result decision authoritative. The simpler Node
    // scorer cannot assess resume semantics and must not replace it with
    // unrelated recommendations.
    if (!pythonRankingSucceeded && candidates.length > 0) {
      console.log("Applying resilient in-node scoring to", candidates.length, "candidates");
      ranked = candidates
        .filter((job) => fallbackJobMeetsFilters(job, {
          location: retrievalLocation,
          jobType: retrievalJobType,
          workMode: retrievalWorkMode,
          hoursOld,
          profile,
        }))
        .map((job) => fallbackScoreJob(job, {
          searchTerm: roleAwareSearchTerm,
          profile: rankingProfile,
        }));
      if (
        !hasSearchInputs &&
        (
          profile?.resumeText ||
          profile?.targetRole ||
          profile?.skills?.length ||
          profile?.resumeSkills?.length
        )
      ) ranked = ranked.filter((job) => job.profileRelevant);
      if (roleAwareSearchTerm.trim()) ranked = ranked.filter((job) => job.searchRelevant);
      ranked.sort((a, b) => {
        if (hasSearchTerm) {
          return (
            (b.searchMatchPercentage ?? 0) -
              (a.searchMatchPercentage ?? 0) ||
            (b.finalRankingScore ?? b.matchScore ?? 0) -
              (a.finalRankingScore ?? a.matchScore ?? 0)
          );
        }
        return (
          (b.finalRankingScore ?? b.matchScore ?? 0) -
          (a.finalRankingScore ?? a.matchScore ?? 0)
        );
      });
    }

    // Apply the same experience gate to Python-ranked results as a final safeguard.
    ranked = ranked.filter((job) =>
      fallbackExperienceMatches(job, profile)
    );

    // Populate source summary if empty
    if (Object.keys(sourceSummary).length === 0) {
      for (const j of ranked) {
        const sName = cleanString(j.source) || "Job Board";
        sourceSummary[sName] = (sourceSummary[sName] || 0) + 1;
      }
    }

    // ========================================================
    // STEP 3: RETURN RESULTS INSTANTLY
    // ========================================================

    const finalJobs = ranked.slice(0, resultsWanted);
    console.log("Final jobs returned to user:", finalJobs.length);

    return res.json({
      success: true,
      count: finalJobs.length,
      jobs: finalJobs,
      cached: true,
      refreshing: Boolean(refreshResult?.refreshing),
      sourceSummary,
      providerSummary,
      message:
        finalJobs.length === 0 && refreshResult?.ok === false
          ? "Unable to fetch jobs right now. Please try again later."
          : finalJobs.length === 0 &&
              Number(rankingDiagnostics?.hardFilters?.too_old) > 0
            ? "A fresh job search completed, but no current jobs matched your profile and preferences. Please try again later."
          : undefined,
      search: {
        search_term: searchTerm,
        location: location,
        effectiveLocation: retrievalLocation,
        job_type: jobType,
        work_mode: workMode,
        hours_old: hoursOld,
        source: source,
        searchEntered: Boolean(searchTerm.trim()),
        effectiveQuery: searchTerm || cleanString(profile?.targetRole) || "All Jobs",
      },
    });
  } catch (error) {
    console.error(
      "\n❌ searchJobs error:"
    );

    console.error(
      error
    );

    if (
      error?.response?.data
    ) {
      console.error(
        "Python response:",
        error.response.data
      );
    }

    return res.status(
      500
    ).json({
      success:
        false,

      message:
        "Unable to search jobs.",

      error:
        error.message,
    });
  }
};

// ============================================================
// GET STORED JOBS
// ============================================================

const getStoredJobs = async (
  req,
  res
) => {
  try {
    const jobs =
      await Job.find({})
        .sort({
          scrapedAt: -1,
        })
        .lean();

    return res.json({
      success:
        true,

      count:
        jobs.length,

      jobs,
    });
  } catch (error) {
    console.error(
      "getStoredJobs error:",
      error
    );

    return res.status(
      500
    ).json({
      success:
        false,

      message:
        "Unable to load stored jobs.",
    });
  }
};

// ============================================================
// MANUAL REFRESH ENDPOINT
// ============================================================

const refreshJobs = async (
  req,
  res
) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.user?.userId;
    const profile = await getUserProfile(userId);
    const requestedResults = Number(
      req.query.results_wanted ??
        req.query.resultsWanted ??
        DEFAULT_RESULTS_WANTED
    );
    const resultsWanted =
      Number.isFinite(requestedResults) && requestedResults > 0
        ? Math.min(500, Math.floor(requestedResults))
        : DEFAULT_RESULTS_WANTED;

    const source =
      cleanString(
        req.query.sites ??
          req.query.source
      );

    const result =
      await refreshJobsNow({
        source,
        searchTerm:
          req.query.search_term ??
          req.query.searchTerm ??
          getProfileSearchTerm(profile),
        location:
          req.query.location ??
          profile.preferredLocation,
        jobType:
          req.query.job_type ??
          req.query.jobType ??
          profile.lookingFor,
        workMode:
          req.query.work_mode ??
          req.query.workMode ??
          profile.preferredWorkMode,
        hoursOld: req.query.hours_old ?? req.query.hoursOld,
        resultsWanted,
        profile,
      });

    return res.json({
      success:
        true,

      count:
        result.jobs.length,

      jobs:
        result.jobs,

      sourceSummary:
        result.sourceSummary,

      providerSummary:
        result.providerSummary,

      saved:
        result.saved,

      duplicates:
        result.duplicates,

      retrieval:
        "wide",
    });
  } catch (error) {
    console.error(
      "refreshJobs error:",
      error
    );

    return res.status(
      502
    ).json({
      success:
        false,

      message:
        "Unable to refresh jobs.",
    });
  }
};

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  searchJobs,
  getStoredJobs,
  refreshJobs,
  buildMongoSearchQuery,
  getEffectiveSearchParams,
  fallbackJobIsRecent,
  fallbackExperienceMatches,
  fetchSearchCandidates,
};
