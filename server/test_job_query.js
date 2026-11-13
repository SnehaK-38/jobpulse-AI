const assert = require("assert");

const {
  buildMongoSearchQuery,
  getEffectiveSearchParams,
  fallbackJobIsRecent,
  fallbackExperienceMatches,
  fetchSearchCandidates,
} = require("./controllers/jobController");

const hasRemoteClause = (query) =>
  (query.$or || []).some(
    (clause) =>
      clause.isRemote === true ||
      clause.workMode instanceof RegExp &&
        clause.workMode.test("Remote")
  );

const onSiteQuery = buildMongoSearchQuery({
  location: "Mumbai",
  workMode: "On-site",
});
assert.strictEqual(hasRemoteClause(onSiteQuery), false);
const onSiteLocationClauses = onSiteQuery.$and
  ? onSiteQuery.$and.find((clause) => Array.isArray(clause.$or))
  : onSiteQuery;
assert.strictEqual(
  onSiteLocationClauses.$or.some((clause) => clause.location?.$regex.test("Navi Mumbai")),
  true
);
assert.strictEqual(
  onSiteLocationClauses.$or.some((clause) => clause.location?.$regex.test("Thane")),
  true
);
const onSiteSourceFallback = onSiteLocationClauses.$or.find(
  (clause) => clause.sourceSearchLocation
);
assert.strictEqual(Array.isArray(onSiteSourceFallback.$and), true);
assert.strictEqual(
  onSiteSourceFallback.$and.some((clause) => clause.isRemote?.$ne === true),
  true
);
assert.strictEqual(
  onSiteSourceFallback.$and.some((clause) => clause.workMode?.$not instanceof RegExp),
  true
);

const hybridQuery = buildMongoSearchQuery({
  location: "Mumbai",
  workMode: "Hybrid",
});
assert.strictEqual(hasRemoteClause(hybridQuery), false);

const remoteQuery = buildMongoSearchQuery({
  location: "Mumbai",
  workMode: "Remote",
});
assert.strictEqual(hasRemoteClause(remoteQuery), true);

const unrestrictedQuery = buildMongoSearchQuery({
  location: "Mumbai",
});
assert.strictEqual(hasRemoteClause(unrestrictedQuery), true);

const profileSearchParams = getEffectiveSearchParams({
  searchTerm: "",
  location: "",
  jobType: "",
  workMode: "",
  profile: {
    targetRole: "Software Engineer",
    preferredLocation: "Mumbai",
    lookingFor: "Full-Time",
    preferredWorkMode: "On-site",
  },
});
assert.strictEqual(profileSearchParams.effectiveLocation, "Mumbai");
assert.strictEqual(profileSearchParams.effectiveJobType, "Full-Time");
assert.strictEqual(profileSearchParams.effectiveWorkMode, "On-site");
assert.strictEqual(profileSearchParams.retrievalSearchTerm, "Software Engineer");

const explicitLocationSearchParams = getEffectiveSearchParams({
  searchTerm: "",
  location: "Pune",
  jobType: "",
  workMode: "",
  profile: {
    targetRole: "Software Engineer",
    preferredLocation: "Mumbai",
    lookingFor: "Full-Time",
    preferredWorkMode: "On-site",
  },
});
assert.strictEqual(explicitLocationSearchParams.effectiveLocation, "Pune");
assert.strictEqual(explicitLocationSearchParams.effectiveJobType, "Full-Time");
assert.strictEqual(explicitLocationSearchParams.effectiveWorkMode, "On-site");
assert.strictEqual(explicitLocationSearchParams.retrievalSearchTerm, "Software Engineer");

const recentScrapeWithStalePosting = {
  postedDate: new Date(Date.now() - 125 * 24 * 60 * 60 * 1000),
  scrapedAt: new Date(),
};
assert.strictEqual(fallbackJobIsRecent(recentScrapeWithStalePosting), false);

const recentPosting = {
  postedDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
  scrapedAt: new Date(),
};
assert.strictEqual(fallbackJobIsRecent(recentPosting), true);

const threeYearProfile = { yearsOfExperience: 3 };
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Requires 2 to 4 years of engineering experience.",
  }, threeYearProfile),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Requires 4+ years of engineering experience.",
  }, threeYearProfile),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Requires three to five years of relevant experience.",
  }, threeYearProfile),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Up to 5 years of relevant experience.",
  }, threeYearProfile),
  true
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Up to 2 years of relevant experience.",
  }, threeYearProfile),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Requires 6 years of backend experience.",
  }, { yearsOfExperience: 4 }),
  true
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Requires 2 years of backend experience.",
  }, { yearsOfExperience: 0 }),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Minimum 5 years of relevant software engineering experience.",
  }, { yearsOfExperience: 2 }),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Minimum 5 years of relevant software engineering experience.",
  }, { yearsOfExperience: 4 }),
  true
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Experience: 4–6 years",
  }, { yearsOfExperience: 8 }),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Experience with backend systems for 5 years",
  }, { yearsOfExperience: 3 }),
  true
);
assert.strictEqual(
  fallbackExperienceMatches({
    minExperienceYears: 5,
    maxExperienceYears: 7,
  }, { yearsOfExperience: 2 }),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    minExperienceYears: 5,
    maxExperienceYears: 7,
  }, { yearsOfExperience: 4 }),
  true
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Requires 10+ years of experience.",
  }, {}),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Strong communication and teamwork skills.",
  }, {}),
  true
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Freshers are welcome to apply.",
  }, {}),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Posted in 2024. Strong communication and teamwork skills.",
  }, { yearsOfExperience: 2 }),
  true
);
assert.strictEqual(
  fallbackExperienceMatches({
    title: "Senior Full Stack Engineer",
    description: "We are looking for a senior engineer to lead platform modernization.",
  }, { yearsOfExperience: 7 }),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    title: "Backend Engineer",
    description: "We need a tech lead who can mentor the team and drive architecture. Requires 3 to 4 years of backend experience.",
  }, { yearsOfExperience: 7 }),
  false
);
assert.strictEqual(
  fallbackExperienceMatches({
    title: "Backend Engineer",
    description: "Requires 5 to 8 years of backend engineering experience.",
  }, { yearsOfExperience: 6 }),
  true
);
for (const yearsOfExperience of [0, 1, 2]) {
  assert.strictEqual(
    fallbackExperienceMatches({
      description: "Freshers are welcome to apply.",
    }, { yearsOfExperience }),
    false
  );
}
assert.strictEqual(
  fallbackExperienceMatches({
    description: "Freshers are welcome to apply.",
  }, { yearsOfExperience: 3 }),
  false
);

const fakeJobs = [
  ...Array.from({ length: 10 }, (_, index) => ({
    _id: `indeed-${index}`,
    source: "Indeed",
    scrapedAt: new Date(Date.now() - index * 1000),
  })),
  ...Array.from({ length: 2 }, (_, index) => ({
    _id: `linkedin-${index}`,
    source: "LinkedIn",
    scrapedAt: new Date(Date.now() - (index + 20) * 1000),
  })),
];
const fakeJobModel = {
  distinct: async () => ["Indeed", "LinkedIn", "linkedin"],
  find: (query) => {
    let rows = fakeJobs;
    const sourceCondition = query.$and?.find((clause) => clause.source);
    const excludedClause = query.$and?.find((clause) => clause._id);
    const excludedIds = excludedClause?._id?.$nin || [];
    if (sourceCondition) {
      rows = rows.filter((job) => sourceCondition.source.$regex.test(job.source));
    }
    if (excludedIds.length) {
      rows = rows.filter((job) => !excludedIds.includes(job._id));
    }
    return {
      sort() {
        return this;
      },
      limit(count) {
        this.count = count;
        return this;
      },
      lean() {
        return Promise.resolve(rows.slice(0, this.count));
      },
    };
  },
};

fetchSearchCandidates({}, 6, fakeJobModel).then((candidates) => {
  assert.strictEqual(candidates.length, 6);
  assert.strictEqual(
    candidates.some((job) => job.source === "LinkedIn"),
    true
  );
  assert.strictEqual(
    candidates.filter((job) => job.source === "Indeed").length <= 4,
    true
  );
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
