// ============================================================
// JobPulse Matching Engine
// ============================================================
//
// Two separate concepts:
//
// 1. Search relevance
//    Does this job match what the user typed?
//
// 2. Profile relevance
//    How suitable is this job for the user's profile?
//
// Final behavior:
//
// Search present:
//   70% search relevance
//   30% profile relevance
//
// Search absent:
//   100% profile relevance
//
// ============================================================


// ============================================================
// TEXT NORMALIZATION
// ============================================================

const normalizeText = (
  text = ""
) => {

  return String(text)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(
      /[^\w+#.\-\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
};


// ============================================================
// SKILL NORMALIZATION
// ============================================================

const normalizeSkill = (
  skill = ""
) => {
  return normalizeText(
    skill
  );
};

const canonicalSkillToken = (
  skill = ""
) => {
  const token = normalizeText(skill)
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
    .replace(/\s+/g, " ")
    .trim();

  return token;
};

const levenshteinDistance = (
  left,
  right
) => {
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

const skillsEquivalent = (
  left = "",
  right = ""
) => {
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


const normalizeSkillArray = (
  skills = []
) => {

  if (!Array.isArray(skills)) {
    return [];
  }

  return [
    ...new Set(
      skills
        .map(normalizeSkill)
        .filter(Boolean)
    ),
  ];
};


// ============================================================
// EXTRACT KNOWN SKILLS FROM JOB
// ============================================================

const extractJobSkills = (
  job
) => {
  const jobSkillsFromSource =
    Array.isArray(job.skills)
      ? job.skills
      : [];

  const jobText =
    normalizeText(
      [
        job.title,
        job.description,
        jobSkillsFromSource.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
    );

  const explicitSkills =
    normalizeSkillArray(
      jobSkillsFromSource
    );

  const inferred =
    jobText
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 3
      )
      .filter(
        (word) =>
          !/^(the|and|for|with|from|into|your|this|that|job|developer|engineer|intern|full|stack|remote|hybrid|onsite|office|company|team|experience|skills|role)$/i.test(word)
      );

  return [
    ...new Set(
      [
        ...explicitSkills,
        ...inferred,
      ]
    ),
  ].slice(0, 25);
};


// ============================================================
// SKILL MATCHING
// ============================================================

const calculateSkillMatch = (
  profileSkills,
  job
) => {

  const userSkills =
    normalizeSkillArray(
      profileSkills
    );


  const detectedJobSkills =
    extractJobSkills(
      job
    );


  const jobText =
    normalizeText(
      [
        job.title,
        job.description,
        Array.isArray(job.skills)
          ? job.skills.join(" ")
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    );


  const matchedSkills = [];

  const missingSkills = [];

  const textTokens = new Set(
    jobText
      .split(/\s+/)
      .map((token) => canonicalSkillToken(token))
      .filter(Boolean)
  );

  for (
    const skill
    of userSkills
  ) {
    const canonicalSkill = canonicalSkillToken(skill);
    const isMatched = detectedJobSkills.some((detectedSkill) => skillsEquivalent(detectedSkill, skill)) ||
      [...textTokens].some((token) => skillsEquivalent(token, canonicalSkill));

    if (isMatched) {
      matchedSkills.push(skill);
    } else {
      missingSkills.push(skill);
    }
  }


  const skillMatchPercentage =
    userSkills.length > 0
      ? Math.round(
          (
            matchedSkills.length /
            userSkills.length
          ) *
          100
        )
      : 0;


  const jobMatchedSkills =
    userSkills.filter(
      (skill) =>
        detectedJobSkills.includes(
          skill
        )
    );


  const jobRequirementCoverage =
    detectedJobSkills.length > 0
      ? Math.round(
          (
            jobMatchedSkills.length /
            detectedJobSkills.length
          ) *
          100
        )
      : 0;


  return {

    skillMatchPercentage,

    jobRequirementCoverage,

    profileSkills:
      userSkills,

    jobSkills:
      detectedJobSkills,

    matchedSkills,

    missingSkills,
  };
};


// ============================================================
// ROLE MATCH
// ============================================================

const calculateRoleMatch = (
  profileRole,
  jobTitle
) => {

  const role =
    normalizeText(
      profileRole
    );

  const title =
    normalizeText(
      jobTitle
    );


  if (!role || !title) {
    return 0;
  }


  if (
    title === role
  ) {
    return 100;
  }


  if (
    title.includes(role)
  ) {
    return 95;
  }


  const roleWords =
    role
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 3
      );


  if (
    roleWords.length === 0
  ) {
    return 0;
  }


  const matched =
    roleWords.filter(
      (word) =>
        title.includes(word)
    );


  return Math.round(
    (
      matched.length /
      roleWords.length
    ) *
    100
  );
};


// ============================================================
// SEARCH MATCH
// ============================================================

const calculateSearchMatch = (
  query,
  job
) => {
  const search =
    normalizeText(
      query
    );

  if (!search) {
    return 100;
  }

  const title =
    normalizeText(
      job.title
    );

  const company =
    normalizeText(
      job.company
    );

  const description =
    normalizeText(
      job.description
    );

  const skills =
    normalizeText(
      Array.isArray(job.skills)
        ? job.skills.join(" ")
        : ""
    );

  if (
    title === search ||
    title.includes(search)
  ) {
    return 100;
  }

  const queryWords =
    search
      .split(/\s+/)
      .filter(
        (word) =>
          word.length >= 2
      );

  if (
    queryWords.length === 0
  ) {
    return 0;
  }

  let titleMatches = 0;
  let bodyMatches = 0;

  for (
    const word
    of queryWords
  ) {
    if (
      title.includes(word)
    ) {
      titleMatches++;
    }

    if (
      description.includes(word) ||
      skills.includes(word) ||
      company.includes(word)
    ) {
      bodyMatches++;
    }
  }

  const titleRatio =
    titleMatches /
    queryWords.length;

  const bodyRatio =
    bodyMatches /
    queryWords.length;

  const score =
    (
      titleRatio * 75 +
      bodyRatio * 25
    );

  return Math.round(
    Math.min(
      100,
      score * 100
    )
  );
};


// ============================================================
// SEARCH RELEVANCE FILTER
// ============================================================
//
// A job must have meaningful relevance before we rank it.
//
// This is what stops:
// "Java Developer"
// from returning random:
// "Full Stack Developer"
// merely because the description says "JavaScript".
//
// ============================================================

const isSearchRelevant = (
  query,
  job
) => {
  const search =
    normalizeText(
      query
    );

  if (!search) {
    return true;
  }

  const score =
    calculateSearchMatch(
      search,
      job
    );

  return score >= 30;
};


// ============================================================
// LOCATION MATCH
// ============================================================

const calculateLocationMatch = (
  preferredLocation,
  job
) => {

  const preferred =
    normalizeText(
      preferredLocation
    );


  const jobLocation =
    normalizeText(
      job.location
    );


  if (!preferred) {
    return 50;
  }


  if (
    job.isRemote
    &&
    (
      preferred.includes(
        "remote"
      )
      ||
      preferred.includes(
        "anywhere"
      )
    )
  ) {

    return 100;
  }


  const words =
    preferred
      .split(/[,\s]+/)
      .filter(
        (word) =>
          word.length >= 3
      );


  if (
    words.length === 0
  ) {
    return 50;
  }


  const matches =
    words.filter(
      (word) =>
        jobLocation.includes(
          word
        )
    );


  if (
    matches.length ===
    words.length
  ) {

    return 100;
  }


  if (
    matches.length > 0
  ) {

    return 60;
  }


  // A remote job is still partially useful
  // even if location doesn't exactly match.

  if (
    job.isRemote
  ) {

    return 70;
  }


  return 0;
};


// ============================================================
// WORK MODE MATCH
// ============================================================

const calculateWorkModeMatch = (
  preferredMode,
  job
) => {

  const mode =
    normalizeText(
      preferredMode
    );


  const text =
    normalizeText(
      [
        job.location,
        job.description,
        job.jobType,
      ]
        .filter(Boolean)
        .join(" ")
    );


  if (!mode) {
    return 50;
  }


  if (
    mode === "remote"
  ) {

    return job.isRemote
      ? 100
      : 0;
  }


  if (
    mode === "hybrid"
  ) {

    return text.includes(
      "hybrid"
    )
      ? 100
      : 40;
  }


  if (
    mode === "on-site"
    ||
    mode === "onsite"
  ) {

    if (
      text.includes("on-site")
      ||
      text.includes("onsite")
      ||
      text.includes("office")
    ) {

      return 100;
    }


    return job.isRemote
      ? 0
      : 70;
  }


  return 50;
};


// ============================================================
// JOB TYPE MATCH
// ============================================================

const calculateJobTypeMatch = (
  lookingFor,
  job
) => {

  const preference =
    normalizeText(
      lookingFor
    );


  const type =
    normalizeText(
      job.jobType
    );


  const text =
    normalizeText(
      [
        job.title,
        job.description,
        job.jobType,
      ]
        .filter(Boolean)
        .join(" ")
    );


  if (!preference) {
    return 50;
  }


  if (
    preference ===
    "internship"
  ) {

    return (
      type.includes("intern")
      ||
      text.includes("internship")
      ||
      text.includes("intern ")
    )
      ? 100
      : 0;
  }


  if (
    preference ===
    "full-time"
  ) {

    return (
      type.includes("full")
      ||
      text.includes("full-time")
      ||
      text.includes("full time")
    )
      ? 100
      : 0;
  }


  // Both
  if (
    preference ===
    "both"
  ) {
    return 100;
  }


  return 50;
};


// ============================================================
// PROFILE EVIDENCE
// ============================================================

const calculateProfileEvidence = (
  profile,
  job
) => {

  const evidence = [];


  if (
    Array.isArray(
      profile.projects
    )
  ) {

    evidence.push(
      ...profile.projects
    );
  }


  if (
    Array.isArray(
      profile.experience
    )
  ) {

    evidence.push(
      ...profile.experience
    );
  }


  if (
    Array.isArray(
      profile.certifications
    )
  ) {

    evidence.push(
      ...profile.certifications
    );
  }


  if (
    Array.isArray(
      profile.achievements
    )
  ) {

    evidence.push(
      ...profile.achievements
    );
  }


  if (
    evidence.length === 0
  ) {
    return 50;
  }


  const jobText =
    normalizeText(
      [
        job.title,
        job.description,
      ]
        .filter(Boolean)
        .join(" ")
    );


  let matches = 0;


  for (
    const item
    of evidence
  ) {

    const words =
      normalizeText(
        item
      )
        .split(/\s+/)
        .filter(
          (word) =>
            word.length >= 4
        );


    if (
      words.length === 0
    ) {
      continue;
    }


    const overlap =
      words.filter(
        (word) =>
          jobText.includes(
            word
          )
      ).length;


    if (
      (
        overlap /
        words.length
      ) >= 0.25
    ) {

      matches++;
    }
  }


  return Math.round(
    (
      matches /
      evidence.length
    ) * 100
  );
};


// ============================================================
// MAIN PROFILE MATCH
// ============================================================

const matchJobToProfile = (
  profile,
  job
) => {

  const skill =
    calculateSkillMatch(
      profile.skills || [],
      job
    );


  const role =
    calculateRoleMatch(
      profile.targetRole,
      job.title
    );


  const location =
    calculateLocationMatch(
      profile.preferredLocation,
      job
    );


  const workMode =
    calculateWorkModeMatch(
      profile.preferredWorkMode,
      job
    );


  const jobType =
    calculateJobTypeMatch(
      profile.lookingFor,
      job
    );


  const evidence =
    calculateProfileEvidence(
      profile,
      job
    );


  // ----------------------------------------------------------
  // PROFILE SCORE
  // ----------------------------------------------------------

  const profileScore =
    Math.round(
      (
        skill.skillMatchPercentage
        * 0.50
      )
      +
      (
        role
        * 0.25
      )
      +
      (
        location
        * 0.05
      )
      +
      (
        workMode
        * 0.05
      )
      +
      (
        jobType
        * 0.05
      )
      +
      (
        evidence
        * 0.10
      )
    );


  const reasons = [];


  if (
    skill.matchedSkills.length > 0
  ) {

    reasons.push(
      `${skill.matchedSkills.length} profile skill(s) match`
    );
  }


  if (
    role >= 80
  ) {

    reasons.push(
      "Strong role alignment"
    );

  } else if (
    role >= 50
  ) {

    reasons.push(
      "Related role"
    );
  }


  if (
    location >= 80
  ) {

    reasons.push(
      "Location matches your preference"
    );

  } else if (
    job.isRemote &&
    location >= 60
  ) {

    reasons.push(
      "Remote opportunity"
    );
  }


  if (
    workMode >= 80
  ) {

    reasons.push(
      "Work mode matches your preference"
    );
  }


  if (
    jobType >= 80
  ) {

    reasons.push(
      "Job type matches your preference"
    );
  }


  if (
    evidence >= 60
  ) {

    reasons.push(
      "Relevant to your projects or experience"
    );
  }


  if (
    reasons.length === 0
  ) {

    reasons.push(
      "Some profile relevance"
    );
  }


  return {

    matchScore:
      Math.max(
        0,
        Math.min(
          100,
          profileScore
        )
      ),

    skillMatchPercentage:
      skill.skillMatchPercentage,

    jobRequirementCoverage:
      skill.jobRequirementCoverage,

    roleMatchPercentage:
      role,

    locationMatchPercentage:
      location,

    workModeMatchPercentage:
      workMode,

    jobTypeMatchPercentage:
      jobType,

    profileEvidencePercentage:
      evidence,

    matchedSkills:
      skill.matchedSkills,

    missingSkills:
      skill.missingSkills,

    detectedJobSkills:
      skill.jobSkills,

    matchReasons:
      [...new Set(reasons)],
  };
};


module.exports = {
  normalizeText,
  normalizeSkill,
  normalizeSkillArray,
  extractJobSkills,
  calculateSkillMatch,
  calculateRoleMatch,
  calculateSearchMatch,
  isSearchRelevant,
  matchJobToProfile,
};