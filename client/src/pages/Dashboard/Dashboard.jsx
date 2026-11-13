import { useEffect, useRef, useState } from "react";

import {
  Search,
  MapPin,
  Briefcase,
  Clock3,
  ExternalLink,
  Star,
  CheckCircle2,
  ChevronRight,
  Bookmark,
  BookmarkCheck,
  X,
} from "lucide-react";

import { getDashboardJobs } from "../../services/dashboardService";
import { getValidJobUrl } from "../../services/urlUtils";
import { addJobToShortlist, getJobShortlist, removeJobFromShortlist } from "../../services/jobShortlistService";
import Navbar from "../../components/Navbar/Navbar";

import "./Dashboard.css";

const JOBS_PER_PAGE = 12;

const getDisplayLocation = (job, preferredLocation) => {
  const actualLocation = cleanText(job.location);
  const requestedLocation = cleanText(preferredLocation);
  const sourceSearchLocation = cleanText(job.sourceSearchLocation);
  const isMumbaiSearch = /^(mumbai|bombay|thane|navi mumbai)$/i.test(requestedLocation);
  const providerConfirmsMumbai = isMumbaiSearch &&
    /mumbai|bombay|thane/i.test(sourceSearchLocation);

  if (
    providerConfirmsMumbai &&
    /^(mh|maharashtra)(\s*,?\s*(in|india))?$/i.test(actualLocation)
  ) {
    return `${requestedLocation} area (provider reported Maharashtra)`;
  }

  if (!actualLocation && providerConfirmsMumbai) {
    return `${requestedLocation} search area (listing location unavailable)`;
  }

  return actualLocation || (job.isRemote ? "Remote" : "Location unavailable");
};


// ============================================================
// DASHBOARD
// ============================================================

function Dashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [location, setLocation] = useState("");

  const [jobs, setJobs] = useState([]);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [searched, setSearched] = useState(false);

  const [sourceSummary, setSourceSummary] = useState({});

  const [providerSummary, setProviderSummary] = useState({});

  const [refreshing, setRefreshing] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);

  const [searchInfo, setSearchInfo] = useState(null);
  const [savedJobIds, setSavedJobIds] = useState(new Set());
  const [savingJobId, setSavingJobId] = useState("");

  const refreshTimer = useRef(null);


  const pageCount = Math.ceil(jobs.length / JOBS_PER_PAGE);
  const visibleJobs = jobs.slice(
    (currentPage - 1) * JOBS_PER_PAGE,
    currentPage * JOBS_PER_PAGE
  );
  const pageItems = (() => {
    if (pageCount <= 5) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const pages = [...new Set([
      1,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      pageCount,
    ].filter((page) => page >= 1 && page <= pageCount))].sort((a, b) => a - b);

    return pages.reduce((items, page, index) => {
      if (index > 0 && page - pages[index - 1] > 1) {
        items.push(`ellipsis-${page}`);
      }
      items.push(page);
      return items;
    }, []);
  })();
  const unavailableProviders = Object.entries(providerSummary)
    .filter(([, provider]) => !provider.success)
    .map(([sourceName, provider]) =>
      sourceName === "Gemini Search" && provider.error
        ? `${sourceName}: ${provider.error}`
        : sourceName
    );
  const availableProviderCount = Object.keys(providerSummary).length -
    unavailableProviders.length;

  // ==========================================================
  // FETCH JOBS
  // ==========================================================

  const fetchJobs = async (filters = {}) => {
    try {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }

      const backgroundPoll = filters.backgroundPoll === true;
      if (!backgroundPoll) {
        setLoading(true);
        setCurrentPage(1);
      }
      setRefreshing(false);
      setError("");

      const currentSearchTerm =
        filters.searchTerm !== undefined
          ? filters.searchTerm
          : searchTerm;

      const currentLocation =
        filters.location !== undefined
          ? filters.location
          : location;

      // --------------------------------------------------------
      // IMPORTANT
      //
      // currentSearchTerm may be empty.
      //
      // Empty search means:
      // "Use the user's profile for recommendations."
      //
      // We intentionally DO NOT replace it with the profile
      // targetRole in the search box.
      // --------------------------------------------------------

      const data = await getDashboardJobs({
        search_term: currentSearchTerm,
        location: currentLocation,
        limit: 500,
      });


      const returnedJobs = Array.isArray(
        data?.jobs
      )
        ? data.jobs
        : [];


      setJobs(returnedJobs);


      setSourceSummary(
        data?.sourceSummary || {}
      );

      setProviderSummary(
        data?.providerSummary || {}
      );

      setRefreshing(Boolean(data?.refreshing));


      setSearchInfo(
        data?.search || null
      );

      if (!currentLocation && data?.search?.effectiveLocation) {
        setLocation(data.search.effectiveLocation);
      }


      setSearched(true);


      // --------------------------------------------------------
      // NO RESULTS
      // --------------------------------------------------------

      if (returnedJobs.length === 0) {
        setError(
          data?.refreshing
            ? "Searching all available job sources. Results will appear automatically."
            : data?.message || "No matching jobs were found."
        );
      }

      if (data?.refreshing) {
        refreshTimer.current = window.setTimeout(() => {
          fetchJobs({
            searchTerm: currentSearchTerm,
            location: currentLocation,
            backgroundPoll: true,
          });
        }, 5000);
      }

    } catch (err) {
      console.error(
        "Job search error:",
        err
      );

      setJobs([]);

      setSearchInfo(null);

      setSourceSummary({});

      setProviderSummary({});

      setRefreshing(false);

      setSearched(true);

      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Unable to search jobs."
      );

    } finally {
      if (filters.backgroundPoll !== true) {
        setLoading(false);
      }
    }
  };


  // ==========================================================
  // AUTOMATIC PROFILE RECOMMENDATIONS
  // ==========================================================
  //
  // This is intentionally executed when Dashboard opens.
  //
  // No search text is supplied.
  //
  // Backend then uses the authenticated user's profile:
  //
  // targetRole
  // lookingFor
  // preferredLocation
  // preferredWorkMode
  // skills
  // experience
  // etc.
  //
  // Nothing is hardcoded here.
  // ==========================================================

  useEffect(() => {
    fetchJobs({ searchTerm: "" });

    const loadSavedJobs = async () => {
      try {
        const result = await getJobShortlist();
        const saved = Array.isArray(result?.jobs) ? result.jobs : [];
        setSavedJobIds(new Set(saved.map((job) => String(job._id))));
      } catch (err) {
        console.error("Unable to load saved jobs:", err);
      }
    };
    loadSavedJobs();

    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ==========================================================
  // SEARCH
  // ==========================================================

  const handleSearch = (event) => {
    event.preventDefault();

    fetchJobs();
  };


  // ==========================================================
  // SEARCH INPUT CHANGE
  // ==========================================================

  const handleSearchTermChange = (event) => {
    setSearchTerm(
      event.target.value
    );
  };


  // ==========================================================
  // CLEAR SEARCH
  // ==========================================================

  const handleClearSearch = () => {
    setSearchTerm("");

    /*
     * Immediately return to profile recommendations.
     *
     * Existing location/filter selections are preserved.
     */
    fetchJobs({
      searchTerm: "",
    });
  };


  // ==========================================================
  // SAVE / REMOVE JOB FROM SHORTLIST
  // ==========================================================

  const toggleSavedJob = async (job) => {
    const id = String(job?._id || "");
    if (!id || id === "undefined") {
      setError("This job cannot be saved because its listing ID is unavailable.");
      return;
    }

    try {
      setSavingJobId(id);
      setError("");
      if (savedJobIds.has(id)) {
        await removeJobFromShortlist(id);
        setSavedJobIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      } else {
        await addJobToShortlist(id);
        setSavedJobIds((current) => new Set([...current, id]));
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to update your saved jobs.");
    } finally {
      setSavingJobId("");
    }
  };


  // ==========================================================
  // OPEN JOB DETAILS
  // ==========================================================

  const openJobDetails = (job) => {
    try {
      const jobKey =
        `jobpulse_job_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`;

      localStorage.setItem(
        jobKey,
        JSON.stringify(job)
      );

      const detailsUrl =
        `/job-details?jobKey=${encodeURIComponent(
          jobKey
        )}`;

      window.open(
        detailsUrl,
        "_blank"
      );

    } catch (err) {
      console.error(
        "Failed to open job details:",
        err
      );
    }
  };


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <>
    <Navbar dashboardMode />
    <div className="job-dashboard">

      {/* =====================================================
          HERO
      ===================================================== */}

      <section className="job-hero">

        <div>
          <span className="eyebrow">
            JOBPULSE AI
          </span>

          <h1>
            Find jobs that fit
            <br />
            <span>
              your profile.
            </span>
          </h1>

          <p>
            Search across multiple job sources and discover
            opportunities ranked according to your search intent
            and professional profile.
          </p>
        </div>


        <div className="recommendation-badge">

          <Star size={16} />

          <span>
            Personalized recommendations
          </span>

        </div>

      </section>


      {/* =====================================================
          SEARCH
      ===================================================== */}

      <form
        className="job-search"
        onSubmit={handleSearch}
      >

        {/* ---------------------------------------------------
            SEARCH TERM
        --------------------------------------------------- */}

        <div className="search-field">

          <Search size={18} />

          <input
            type="text"
            value={searchTerm}
            onChange={
              handleSearchTermChange
            }
            placeholder="Job title, role or skill"
          />

          {searchTerm && (
            <button
              type="button"
              className="clear-search-button"
              onClick={handleClearSearch}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}

        </div>


        {/* ---------------------------------------------------
            LOCATION
        --------------------------------------------------- */}

        <div className="search-field">

          <MapPin size={18} />

          <input
            type="text"
            value={location}
            onChange={(event) =>
              setLocation(
                event.target.value
              )
            }
            placeholder="City, state or country"
          />

        </div>


        {/* ---------------------------------------------------
            SEARCH BUTTON
        --------------------------------------------------- */}

        <button
          type="submit"
          disabled={loading}
        >

          <Search size={17} />

          {loading
            ? "Searching..."
            : "Search Jobs"}

        </button>

      </form>


      {/* =====================================================
          SEARCH STATUS
      ===================================================== */}

      {!loading &&
        searched &&
        searchInfo && (

          <div className="search-status">

            <span>

              {searchInfo.searchEntered

                ? `Showing results for "${
                    searchInfo.effectiveQuery ||
                    searchInfo.query ||
                    searchTerm
                  }"`

                : "Showing recommendations based on your profile"}

            </span>

          </div>

        )}


      {/* =====================================================
          SOURCE SUMMARY
      ===================================================== */}

      {!loading &&
        Object.keys(
          sourceSummary
        ).length > 0 && (

          <div className="source-summary">

            {Object.entries(
              sourceSummary
            ).map(
              (
                [
                  sourceName,
                  count,
                ]
              ) => (

                <span
                  className="source-summary-item"
                  key={sourceName}
                >

                  {sourceName}

                  <strong>
                    {count}
                  </strong>

                </span>

              )
            )}

          </div>

        )}

      {!loading && Object.keys(providerSummary).length > 0 && (
        <div className="provider-status" role="status">
          <strong>
            Sources checked:{" "}
            {availableProviderCount}
            /{Object.keys(providerSummary).length} available
          </strong>
          {unavailableProviders.length > 0 && (
            <span>Unavailable: {unavailableProviders.join(", ")}</span>
          )}
        </div>
      )}

      {!loading && refreshing && jobs.length > 0 && (
        <div className="provider-status" role="status">
          Checking all available job sources in the background; showing current matches meanwhile.
        </div>
      )}

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (

        <div className="job-error">
          {error}
        </div>

      )}


      {/* =====================================================
          LOADING
      ===================================================== */}

      {loading && (

        <div className="job-loading">

          <div className="spinner"></div>

          <h3>

            {searchTerm.trim()
              ? "Finding matching jobs..."
              : "Finding your best recommendations..."}

          </h3>

          <p>

            {searchTerm.trim()

              ? "Searching available job sources and analyzing opportunities against your profile and search intent."

              : "Searching available job sources and analyzing opportunities against your professional profile."}

          </p>

        </div>

      )}


      {/* =====================================================
          RESULTS
      ===================================================== */}

      {!loading &&
        jobs.length > 0 && (

          <section>

            <div className="section-heading">

              <div>

                <p className="section-kicker">

                  {searchInfo?.searchEntered
                    ? "SEARCH RESULTS"
                    : "PERSONALIZED FOR YOU"}

                </p>


                <h2>

                  {searchInfo?.searchEntered
                    ? "Jobs matching your search"
                    : "Recommended jobs"}

                </h2>


                <p className="section-description">

                  {searchInfo?.searchEntered

                    ? "Your search intent is prioritized, with profile relevance used to rank suitable results."

                    : "Your profile is used to rank the strongest opportunities first."}

                </p>

              </div>


              <span className="result-count">

                {jobs.length} jobs

              </span>

            </div>


            <div className="jobs-list">

              {visibleJobs.map(
                (
                  job,
                  index
                ) => (

                  <JobCard
                    key={
                      job.jobUrl ||
                      job.applicationUrl ||
                      job._id ||
                      index
                    }
                    job={job}
                    preferredLocation={searchInfo?.effectiveLocation}
                    onSeeMore={openJobDetails}
                    isSaved={savedJobIds.has(String(job._id))}
                    isSaving={savingJobId === String(job._id)}
                    onToggleSave={toggleSavedJob}
                  />

                )
              )}

            </div>

            {pageCount > 1 && (
              <nav className="job-pagination" aria-label="Job result pages">
                <button
                  type="button"
                  className="pagination-direction"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                {pageItems.map((item) => (
                  typeof item === "string" ? (
                    <span className="pagination-ellipsis" key={item}>...</span>
                  ) : (
                    <button
                      type="button"
                      className="pagination-number"
                      key={item}
                      onClick={() => setCurrentPage(item)}
                      aria-label={`Page ${item}`}
                      aria-current={currentPage === item ? "page" : undefined}
                    >
                      {item}
                    </button>
                  )
                ))}
                <button
                  type="button"
                  className="pagination-direction"
                  onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                  disabled={currentPage === pageCount}
                >
                  Next
                </button>
                <span className="pagination-page-label">
                  Page {currentPage} of {pageCount}
                </span>
              </nav>
            )}

          </section>

        )}


      {/* =====================================================
          NO RESULTS
      ===================================================== */}

      {!loading &&
        searched &&
        jobs.length === 0 &&
        !error && (

          <div className="no-results">

            <Search size={32} />

            <h3>
              No jobs found
            </h3>

            <p>
              Try a different job title, role, skill, or location.
            </p>

          </div>

        )}

    </div>
    </>
  );
}


// ============================================================
// JOB CARD
// ============================================================

function JobCard({
  job,
  preferredLocation,
  onSeeMore,
  isSaved,
  isSaving,
  onToggleSave,
}) {

  const score = Number(
    job.finalRankingScore ??
      job.matchScore ??
      0
  );


  const searchScore =
    job.searchMatchPercentage === null ||
    job.searchMatchPercentage === undefined
      ? null
      : Number(
          job.searchMatchPercentage
        );


  const skillScore =
    job.skillMatchPercentage === null ||
    job.skillMatchPercentage === undefined
      ? null
      : Number(
          job.skillMatchPercentage
        );


  const requirementCoverage =
    job.jobRequirementCoverage === null ||
    job.jobRequirementCoverage === undefined
      ? null
      : Number(
          job.jobRequirementCoverage
        );


  const scoreClass =
    score >= 80
      ? "excellent"
      : score >= 60
        ? "good"
        : "fair";


  const applicationUrl = getValidJobUrl(job);


  return (

    <article className="job-card">

      {/* ===================================================
          HEADER
      =================================================== */}

      <div className="job-card-header">

        <div className="job-main">

          <div className="source-row">

            <span className="source">

              {job.source ||
                "Job Board"}

            </span>


            {job.isRemote && (

              <span className="remote">
                Remote
              </span>

            )}

          </div>


          <h3>

            {job.title ||
              "Untitled Job"}

          </h3>


          <p className="company">

            {job.company ||
              "Unknown Company"}

          </p>

        </div>


        <div
          className={`match-score ${scoreClass}`}
        >

          <strong>
            {Math.round(score)}%
          </strong>

          <span>
            match
          </span>

        </div>

      </div>


      {/* ===================================================
          META
      =================================================== */}

      <div className="job-meta">

        <span>

          <MapPin size={15} />

          {getDisplayLocation(job, preferredLocation)}

        </span>


        <span>

          <Briefcase size={15} />

          {job.jobType ||
            job.employmentType ||
            "Job type unavailable"}

        </span>


        <span>
          💼 {formatExperience(job)}
        </span>


        <span>
          🏢 {formatWorkMode(job)}
        </span>


        {formatSalary(job) && (

          <span className="job-salary">

            💰 {formatSalary(job)}

          </span>

        )}

      </div>


      {/* ===================================================
          QUICK MATCH
      =================================================== */}

      <div className="quick-match">

        <div className="quick-match-item">

          <span>
            Search relevance
          </span>

          <strong>

            {searchScore === null
              ? "N/A"
              : `${Math.round(
                  searchScore
                )}%`}

          </strong>

        </div>


        <div className="quick-match-item">

          <span>
            Skill match
          </span>

          <strong>

            {skillScore === null
              ? "N/A"
              : `${Math.round(
                  skillScore
                )}%`}

          </strong>

        </div>


        <div className="quick-match-item">

          <span>
            Requirement coverage
          </span>

          <strong>

            {requirementCoverage === null
              ? "N/A"
              : `${Math.round(
                  requirementCoverage
                )}%`}

          </strong>

        </div>


        <div className="quick-match-item">

          <span>
            Profile match
          </span>

          <strong>

            {Math.round(
              Number(
                job.matchScore ?? 0
              )
            )}

            %

          </strong>

        </div>

        <div className="quick-match-item">
          <span>
            Experience match
          </span>
          <strong>
            {job.experienceDataAvailable === false
              ? "Not provided"
              : job.experienceMatchPercentage === null ||
                  job.experienceMatchPercentage === undefined
                ? "N/A"
                : `${Math.round(Number(job.experienceMatchPercentage))}%`}
          </strong>
        </div>

      </div>


      {/* ===================================================
          MATCH REASONS
      =================================================== */}

      {Array.isArray(
        job.matchReasons
      ) &&
        job.matchReasons.length > 0 && (

          <div className="match-reasons">

            <h4>
              Why this matches you
            </h4>


            <div className="reason-list">

              {job.matchReasons
                .slice(
                  0,
                  3
                )
                .map(
                  (
                    reason,
                    index
                  ) => (

                    <span
                      key={`${reason}-${index}`}
                    >

                      <CheckCircle2
                        size={13}
                      />

                      {cleanText(
                        reason
                      )}

                    </span>

                  )
                )}

            </div>

          </div>

        )}


      {/* ===================================================
          MATCHING SKILLS
      =================================================== */}

        <div className="skill-section">

          {Array.isArray(
            job.matchedSkills
          ) &&
            job.matchedSkills.length > 0 && (

              <>

                <h4>
                  Matching skills
                </h4>

                <div className="skills">

                  {job.matchedSkills
                    .slice(
                      0,
                      8
                    )
                    .map(
                      (
                        skill,
                        index
                      ) => (

                        <span
                          className="matched-skill"
                          key={`matched-${skill}-${index}`}
                        >

                          ✓{" "}
                          {cleanText(
                            skill
                          )}

                        </span>

                      )
                    )}

                </div>

              </>

            )}


          {!job.profileSkillsAvailable &&
            job.skillRequirementsAvailable && (
              <p className="skill-data-note">
                Your profile has no saved skills to compare against this listing.
              </p>
            )}

          {Array.isArray(
            job.missingSkills
          ) &&
            job.missingSkills.length > 0 && (

              <div className="missing-skill-group">

                <h4>
                  Skills mentioned in this job but not listed in your profile
                </h4>

                <div className="skills">

                  {job.missingSkills
                    .slice(
                      0,
                      8
                    )
                    .map(
                      (
                        skill,
                        index
                      ) => (

                        <span
                          className="missing-skill"
                          key={`missing-${skill}-${index}`}
                        >

                          {cleanText(
                            skill
                          )}

                        </span>

                      )
                    )}

                </div>

              </div>

            )}

          {(!Array.isArray(job.missingSkills) || job.missingSkills.length === 0) &&
            job.skillRequirementsAvailable && (
              <p className="skill-data-note">
                No missing listed skills based on the skills in your profile.
              </p>
            )}

          {!job.skillRequirementsAvailable && (
            <p className="skill-data-note">
              This source did not provide identifiable skill requirements. Review the job description.
            </p>
          )}

        </div>

      {/* ===================================================
          JOB DESCRIPTION
      =================================================== */}

      {job.description && (

        <div className="description-section">

          <h4>
            Job description
          </h4>

          <DashboardDescription
            text={
              job.description
            }
          />

        </div>

      )}


      {/* ===================================================
          FOOTER
      =================================================== */}

      <div className="job-card-footer">

        <span className="posted">

          <Clock3 size={14} />

          {job.postedDate
            ? formatDate(
                job.postedDate
              )
            : "Date unavailable"}

        </span>


        <div className="job-actions">

          <button
            type="button"
            className={`save-job-button${isSaved ? " saved" : ""}`}
            onClick={() => onToggleSave(job)}
            disabled={isSaving || !job._id}
          >
            {isSaved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
            {isSaving ? "Saving..." : isSaved ? "Saved" : "Save Job"}
          </button>

          <button
            type="button"
            className="details-button"
            onClick={() =>
              onSeeMore(job)
            }
          >

            See More Details

            <ChevronRight
              size={15}
            />

          </button>


          {applicationUrl ? (

            <a
              href={applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="apply-button"
            >

              Apply Now

              <ExternalLink
                size={15}
              />

            </a>

          ) : (

            <button
              type="button"
              className="apply-button disabled"
              disabled
            >
              Application unavailable
            </button>

          )}

        </div>

      </div>

    </article>
  );
}


// ============================================================
// DASHBOARD DESCRIPTION
// ============================================================

function DashboardDescription({
  text,
}) {

  const cleaned =
    cleanJobDescription(
      text
    );


  if (!cleaned) {
    return (
      <p className="job-description">
        No description available.
      </p>
    );
  }


  const paragraphs =
    cleaned
      .split(
        /\n\s*\n/
      )
      .map(
        (item) =>
          item.trim()
      )
      .filter(Boolean);


  let preview = "";


  for (
    const paragraph of paragraphs
  ) {

    const next =
      preview
        ? `${preview} ${paragraph}`
        : paragraph;


    if (
      next.length > 330
    ) {

      preview =
        next.slice(
          0,
          330
        );

      break;
    }


    preview =
      next;
  }


  if (!preview) {

    preview =
      cleaned.slice(
        0,
        330
      );
  }


  const needsEllipsis =
    cleaned.length >
    preview.length;


  return (

    <p className="job-description">

      {formatDashboardInline(
        preview
      )}

      {needsEllipsis
        ? "..."
        : ""}

    </p>
  );
}


// ============================================================
// CLEAN JOB DESCRIPTION
// ============================================================

function cleanJobDescription(
  value
) {

  if (!value) {
    return "";
  }


  let text =
    String(value);


  text =
    text
      .replace(
        /\\r\\n/g,
        "\n"
      )
      .replace(
        /\\n/g,
        "\n"
      )
      .replace(
        /\r\n/g,
        "\n"
      )
      .replace(
        /\r/g,
        "\n"
      );


  text =
    decodeHtmlEntities(
      text
    );


  text =
    text.replace(
      /<script[\s\S]*?<\/script>/gi,
      ""
    );


  text =
    text.replace(
      /<style[\s\S]*?<\/style>/gi,
      ""
    );


  text =
    text.replace(
      /<br\s*\/?>/gi,
      "\n"
    );


  text =
    text.replace(
      /<(p|div|section|article|h1|h2|h3|h4|h5|h6)[^>]*>/gi,
      "\n\n"
    );


  text =
    text.replace(
      /<\/(p|div|section|article|h1|h2|h3|h4|h5|h6)>/gi,
      "\n\n"
    );


  text =
    text.replace(
      /<li[^>]*>/gi,
      "\n• "
    );


  text =
    text.replace(
      /<\/li>/gi,
      "\n"
    );


  text =
    text.replace(
      /<ul[^>]*>/gi,
      "\n"
    );


  text =
    text.replace(
      /<\/ul>/gi,
      "\n\n"
    );


  text =
    text.replace(
      /<ol[^>]*>/gi,
      "\n"
    );


  text =
    text.replace(
      /<\/ol>/gi,
      "\n\n"
    );


  text =
    text.replace(
      /<[^>]+>/g,
      ""
    );


  text =
    text.replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    );


  text =
    text.replace(
      /__(.*?)__/g,
      "$1"
    );


  text =
    text.replace(
      /^\s*#{1,6}\s+/gm,
      ""
    );


  text =
    text.replace(
      /\[([^\]]+)\]\([^)]+\)/g,
      "$1"
    );


  text =
    text.replace(
      /^[ \t]*[-+*]\s+/gm,
      "• "
    );


  text =
    text.replace(
      /\*/g,
      ""
    );


  text =
    text
      .split("\n")
      .map(
        (line) =>
          line
            .replace(
              /[ \t]+/g,
              " "
            )
            .trim()
      )
      .join("\n");


  text =
    text.replace(
      /\n{3,}/g,
      "\n\n"
    );


  return text.trim();
}


// ============================================================
// INLINE FORMAT
// ============================================================

function formatDashboardInline(
  text
) {

  return String(
    text || ""
  ).replace(
    /\*/g,
    ""
  );
}


// ============================================================
// CLEAN TEXT
// ============================================================

function cleanText(
  value
) {

  return String(
    value || ""
  )
    .replace(
      /<[^>]+>/g,
      ""
    )
    .replace(
      /\*\*(.*?)\*\*/g,
      "$1"
    )
    .replace(
      /__(.*?)__/g,
      "$1"
    )
    .replace(
      /\*/g,
      ""
    )
    .trim();
}


// ============================================================
// HTML ENTITY DECODER
// ============================================================

function decodeHtmlEntities(
  text
) {

  const textarea =
    document.createElement(
      "textarea"
    );

  textarea.innerHTML =
    text;

  return textarea.value;
}


// ============================================================
// DATE FORMAT
// ============================================================

function formatDate(
  value
) {

  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Date unavailable";
  }


  return date.toLocaleDateString(
    undefined,
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    }
  );
}


// ============================================================
// SALARY FORMAT
// ============================================================

function formatSalary(
  job
) {

  const salary =
    cleanText(
      job?.salary
    );


  const missing =
    !salary ||
    [
      "not specified",
      "not mentioned",
      "not disclosed",
      "undisclosed",
      "n/a",
      "na",
    ].includes(
      salary.toLowerCase()
    );


  if (!missing) {
    return salary;
  }


  const min =
    Number(
      job?.minSalary
    );

  const max =
    Number(
      job?.maxSalary
    );


  const hasMin =
    Number.isFinite(
      min
    );

  const hasMax =
    Number.isFinite(
      max
    );


  if (
    !hasMin &&
    !hasMax
  ) {
    return "";
  }


  const currency =
    cleanText(
      job?.salaryCurrency
    );

  const period =
    cleanText(
      job?.salaryPeriod
    );


  const formatNumber =
    (value) =>
      Number(
        value
      ).toLocaleString(
        undefined,
        {
          maximumFractionDigits: 0,
        }
      );


  let text =
    hasMin && hasMax
      ? `${formatNumber(min)} - ${formatNumber(max)}`
      : formatNumber(
          hasMin
            ? min
            : max
        );


  if (currency) {
    text =
      `${currency} ${text}`;
  }


  if (period) {
    text += ` ${period}`;
  }


  return text;
}


// ============================================================
// EXPERIENCE FORMAT
// ============================================================

function formatExperience(
  job
) {

  const direct =
    cleanText(
      job?.experience ||
        job?.experienceLevel
    );


  if (
    direct &&
    !/^not specified$/i.test(
      direct
    )
  ) {
    return direct;
  }


  const match =
    job?.experienceMatch ||
    {};

  if (match.requiredLabel) {
    return match.requiredLabel;
  }


  const min =
    Number(
      match.requiredMinYears
    );

  const max =
    Number(
      match.requiredMaxYears
    );


  if (
    Number.isFinite(
      min
    )
  ) {

    if (
      Number.isFinite(
        max
      ) &&
      max !== min
    ) {
      return `${min} - ${max} years`;
    }


    return min === 0
      ? "Entry level"
      : `${min}+ years`;
  }


  return "Experience not specified";
}


// ============================================================
// WORK MODE FORMAT
// ============================================================

function formatWorkMode(
  job
) {

  const mode =
    cleanText(
      job?.workMode
    );


  if (mode) {
    return mode;
  }


  if (job?.isRemote) {
    return "Remote";
  }


  return "Work mode not specified";
}


// ============================================================
// EXPORT
// ============================================================

export default Dashboard;
