const axios = require("axios");

const Job = require("../models/Job");
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

const REFRESH_COOLDOWN_MS =
  Number(
    process.env.REFRESH_COOLDOWN_MS ||
      600000
  );

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
  const hasSearchInputs = Boolean(explicitSearchTerm || explicitLocation);

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
      hasSearchInputs
        ? explicitSearchTerm
        : cleanString(profile?.targetRole),
  };
};

// ============================================================
// MONGO SEARCH & FILTER QUERY BUILDER
// ============================================================

const buildMongoSearchQuery = ({
  searchTerm = "",
  location = "",
  jobType = "",
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

  // 2. Job Type filter (EXPLICIT)
  const cleanJobType = cleanString(jobType);
  if (cleanJobType) {
    const jt = cleanJobType.toLowerCase();
    if (jt.includes("intern")) {
      andClauses.push({
        $or: [
          { jobType: { $regex: /intern/i } },
          { employmentType: { $regex: /intern/i } },
          { title: { $regex: /\b(intern(ship)?|trainee|apprentice|co[- ]?op)\b/i } },
        ],
      });
    } else if (jt.includes("full")) {
      andClauses.push({ jobType: { $regex: /full/i } });
    } else if (jt.includes("part")) {
      andClauses.push({ jobType: { $regex: /part/i } });
    } else if (jt.includes("contract")) {
      andClauses.push({ jobType: { $regex: /contract/i } });
    } else {
      andClauses.push({ jobType: { $regex: new RegExp(cleanJobType, "i") } });
    }
  }

  // 3. Work Mode filter (EXPLICIT)
  const cleanWorkMode = cleanString(workMode);
  if (cleanWorkMode) {
    const wm = cleanWorkMode.toLowerCase();
    if (wm.includes("remote")) {
      andClauses.push({ $or: [{ workMode: /remote/i }, { isRemote: true }] });
    } else if (wm.includes("hybrid")) {
      andClauses.push({ workMode: /hybrid/i });
    } else if (wm.includes("site") || wm.includes("onsite") || wm.includes("on-site")) {
      andClauses.push({ workMode: /onsite|on-site|office/i });
    }
  }

  // 4. Location filter (EXPLICIT)
  const cleanLocation = cleanString(location);
  if (cleanLocation) {
    andClauses.push({
      $or: [
        { location: { $regex: cleanLocation, $options: "i" } },
        { sourceSearchLocation: { $regex: cleanLocation, $options: "i" } },
        { isRemote: true },
        { workMode: /remote/i },
      ],
    });
  }

  // 5. Date filter (EXPLICIT)
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

  // 6. Search Term (EXPLICIT)
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
  const experienceText = cleanString(profile?.experienceLevel || profile?.yearsOfExperience || profile?.experience) || "0 years fresher";
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
  for (const ps of profileSkills) {
    if (containsTerm(jobText, ps)) {
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

  const profileYears = Number(experienceText.match(/\d+(?:\.\d+)?/)?.[0] || 0);
  const jobYears = Number(jobText.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i)?.[1] || 0);
  const mentionsExperience = /\d+\s*\+?\s*(?:years?|yrs?)/i.test(jobText);
  const isEntryLevelJob = /intern|internship|fresher|entry.level|graduate|trainee/i.test(`${title} ${desc}`);
  const experienceScore = mentionsExperience
    ? (profileYears >= jobYears ? 100 : Math.max(0, 100 - (jobYears - profileYears) * 25))
    : (isEntryLevelJob || profileYears > 0 ? 100 : 60);

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

const fallbackExperienceMatches = (job, profile = {}) => {
  const profileExperience = profile?.experienceLevel ||
    profile?.yearsOfExperience ||
    profile?.experience;
  const profileText = cleanString(
    typeof profileExperience === "string"
      ? profileExperience
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
  if (profileYears === null) return true;

  const experienceField = cleanString(
    job?.experience || job?.experienceLevel || job?.requiredExperience
  );
  const structuredExperience = job?.experience ?? job?.experienceLevel ?? job?.requiredExperience;
  const requirements = cleanString(job?.requirements);
  const requirementText = `${experienceField} ${requirements}`;
  const range = requirementText.match(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/i);
  const plus = requirementText.match(/(\d+(?:\.\d+)?)\s*(?:\+|plus)\s*(?:years?|yrs?)/i);
  const exactField = experienceField.match(/^\s*(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s*$/i);
  const single = requirementText.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+|professional\s+|work\s+)?experience/i);

  let minYears = null;
  let maxYears = null;
  if (range) {
    minYears = Number(range[1]);
    maxYears = Number(range[2]);
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
  } else if (single) {
    minYears = Number(single[1]);
  } else if (/\b(fresher|entry.level|intern(ship)?|trainee|apprentice|new grad)\b/i.test(`${job?.title || ""} ${experienceField}`)) {
    minYears = 0;
    maxYears = 0;
  }

  if (minYears === null && maxYears === null) return true;
  const gap = minYears !== null && profileYears < minYears
    ? minYears - profileYears
    : maxYears !== null && profileYears > maxYears
      ? profileYears - maxYears
      : 0;
  return gap <= 2;
};

const fallbackJobMeetsFilters = (job, { location = "", jobType = "", workMode = "", profile = {} }) => {
  const text = `${cleanString(job.title)} ${cleanString(job.jobType)} ${cleanString(job.description)}`.toLowerCase();
  const mode = cleanString(workMode).toLowerCase();
  const anyWorkMode = ["both", "any", "all"].includes(mode);
  const remote = Boolean(job.isRemote) || /\bremote\b/i.test(`${job.workMode || ""} ${job.location || ""} ${job.description || ""}`);
  const hybrid = /\bhybrid\b/i.test(`${job.workMode || ""} ${job.description || ""}`);
  const onsite = /\b(on.?site|in.?office)\b/i.test(`${job.workMode || ""} ${job.description || ""}`);
  if (!anyWorkMode && mode === "remote" && !remote) return false;
  if (!anyWorkMode && mode === "hybrid" && !hybrid) return false;
  if (!anyWorkMode && ["onsite", "on-site", "on site"].includes(mode) && (remote || !onsite)) return false;

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
      const explicitProviderFullTime =
        /fulltime/.test(normalizedProviderType);
      const explicitTitleFullTime =
        /\bfull[- ]?time\b/i.test(title);
      const explicitDescriptionFullTime =
        /(?:job|employment)\s*type\s*[:\-]\s*full[- ]?time\b|\bfull[- ]?time\s+(?:position|role|opportunity|employment|schedule)\b/i.test(
          cleanString(job.description)
        );
      if (
        explicitlyOtherType ||
        titleIndicatesOtherType ||
        !(
          explicitProviderFullTime ||
          explicitTitleFullTime ||
          explicitDescriptionFullTime
        )
      ) return false;
    } else {
      const text = `${cleanString(job.title)} ${providerType} ${cleanString(job.description)}`.toLowerCase();
      const actualType = /intern/.test(text) ? "internship"
        : /part.?time/.test(text) ? "parttime"
          : /contract/.test(text) ? "contract" : "";
      if (!actualType || actualType !== type) return false;
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
    const job =
      normalizeJobForDatabase(
        rawJob
      );

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
// Provider retrieval receives the user's search intent and hard preferences.
// Python applies the same eligibility filters to every provider's results
// before the backend persists them. Resume skill matching happens later in
// the ranking request, after collection and eligibility filtering.
// ============================================================

const refreshJobsNow = async ({
  source,
  searchTerm = "",
  location = "",
  jobType = "",
  workMode = "",
  hoursOld = null,
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
            DEFAULT_RESULTS_WANTED,
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
    const key =
      JSON.stringify({
        searchTerm:
          cleanString(
            searchTerm
          ),

        location:
          cleanString(
            location
          ),

        jobType:
          cleanString(
            jobType
          ),

        workMode:
          cleanString(
            workMode
          ),

        hoursOld:
          cleanString(
            hoursOld
          ),

        source:
          cleanString(
            source
          ),
      });

    const now =
      Date.now();

    const previous =
      refreshState.get(
        key
      );

    if (
      previous?.running
    ) {
      return previous.promise;
    }

    if (
      previous?.finishedAt &&
      now -
        previous.finishedAt <
        REFRESH_COOLDOWN_MS
    ) {
      return {
        skipped: true,
        providerSummary: previous.providerSummary || {},
      };
    }

    if (previous?.retryAfter && now < previous.retryAfter) {
      return { skipped: true };
    }

    const refreshPromise = refreshJobsNow({
        source,
        searchTerm,
        location,
        jobType,
        workMode,
        hoursOld,
      })
      .then((result) => ({ ok: true, result }))
      .catch((error) => {
        console.error("Job refresh failed:", error.message);
        return { ok: false, error };
      })
      .then((result) => {
        if (result?.ok) {
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

    return refreshPromise;
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

    return {
      jobs:
        rankedJobs,

      sourceSummary:
        response.data
          ?.sourceSummary ||
        {},
    };
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

    const hasSearchTerm = Boolean(searchTerm.trim());
    const hasSearchInputs = Boolean(hasSearchTerm || location);

    const jobType =
      hasSearchInputs
        ? ""
        : cleanString(
            req.query.job_type ??
              req.query.jobType
          );

    const workMode =
      hasSearchInputs
        ? ""
        : cleanString(
            req.query.work_mode ??
              req.query.workMode
          );

    const hoursOld =
      hasSearchInputs
        ? ""
        : cleanString(
            req.query.hours_old ??
              req.query.hoursOld
          );

    const source =
      hasSearchInputs
        ? ""
        : cleanString(
            req.query.sites ??
              req.query.source
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
      jobType: retrievalJobType,
      workMode: retrievalWorkMode,
      source,
      hoursOld,
    });

    console.log("Mongo query:", JSON.stringify(mongoQuery));

    let candidates = await Job.find(mongoQuery)
      .sort({ scrapedAt: -1 })
      .limit(CACHE_RANK_LIMIT)
      .lean();

    console.log("Candidates found in Mongo:", candidates.length);

    // Refresh providers with the same eligibility preferences, and target
    // LinkedIn/Indeed with the
    // user's main resume role, preferred location, and preferred job type.
    const refreshResult = await refreshJobsInBackground({
      searchTerm: effective.retrievalSearchTerm,
      location: retrievalLocation,
      jobType: retrievalJobType,
      workMode: retrievalWorkMode,
      hoursOld: hoursOld || (hasSearchInputs ? null : 1440),
      source,
      resultsWanted,
      profile,
    });
    const providerSummary =
      refreshResult?.result?.providerSummary ||
      refreshResult?.providerSummary ||
      {};

    // Include jobs persisted by the refresh that just completed. Without this
    // reload the current request keeps ranking the pre-refresh snapshot, so
    // newly fetched opportunities only appear on a later dashboard request.
    candidates = await Job.find(mongoQuery)
      .sort({ scrapedAt: -1 })
      .limit(CACHE_RANK_LIMIT)
      .lean();

    // ========================================================
    // STEP 2: AI / PYTHON RANKING WITH IN-NODE RESILIENT FALLBACK
    // ========================================================

    let ranked = [];
    let sourceSummary = {};
    let pythonRankingSucceeded = false;

    if (candidates.length > 0) {
      try {
        const rankedCached = await rankJobsWithPython({
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
        console.log("Python ranked jobs returned:", ranked.length);
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
      refreshing: false,
      sourceSummary,
      providerSummary,
      search: {
        search_term: searchTerm,
        location: location,
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
    const source =
      cleanString(
        req.query.sites ??
          req.query.source
      );

    const result =
      await refreshJobsNow({
        source,
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
};
