import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  BriefcaseBusiness,
  Check,
  ExternalLink,
  MapPin,
  RefreshCw,
  Scale,
  Search,
  X,
} from "lucide-react";
import { getDashboardJobs } from "../../services/dashboardService";
import { getProfile } from "../../services/profileService";
import {
  addJobToShortlist,
  getJobShortlist,
  removeJobFromShortlist,
} from "../../services/jobShortlistService";
import "./JobComparison.css";

const clean = (value) => String(value ?? "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/\s+/g, " ");

const getSkills = (job) => [...new Set([
  ...(Array.isArray(job.skills) ? job.skills : []),
  ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
].map(clean).filter(Boolean))];

const getJobUrl = (job) => job.applicationUrl || job.jobUrlDirect || job.jobUrl || "";

function JobComparison({ analysis }) {
  const [jobs, setJobs] = useState([]);
  const [shortlist, setShortlist] = useState([]);
  const [savedProfileSkills, setSavedProfileSkills] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [jobResult, shortlistResult, profileResult] = await Promise.all([
        getDashboardJobs({ search_term: "", location: "", limit: 200 }),
        getJobShortlist(),
        getProfile(),
      ]);
      setJobs(Array.isArray(jobResult?.jobs) ? jobResult.jobs : []);
      setShortlist(Array.isArray(shortlistResult?.jobs) ? shortlistResult.jobs : []);
      const user = profileResult?.user || {};
      setSavedProfileSkills([
        ...(Array.isArray(user.resumeSkills) ? user.resumeSkills : []),
        ...(Array.isArray(user.skills) ? user.skills : []),
      ]);
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to load jobs and your shortlist. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const profileSkills = useMemo(() => new Set(
    (savedProfileSkills.length ? savedProfileSkills : (analysis?.profile?.currentSkills || [])).map(normalize)
  ), [savedProfileSkills, analysis]);

  const shortlistIds = useMemo(
    () => new Set(shortlist.map((job) => String(job._id))),
    [shortlist]
  );

  const filteredJobs = useMemo(() => {
    const term = normalize(search);
    if (!term) return jobs;
    return jobs.filter((job) =>
      [job.title, job.company, job.location, job.source, ...getSkills(job)]
        .some((value) => normalize(value).includes(term))
    );
  }, [jobs, search]);

  const selectedJobs = useMemo(
    () => selectedIds.map((id) => jobs.find((job) => String(job._id) === id)).filter(Boolean),
    [jobs, selectedIds]
  );

  const toggleCompare = (jobId) => {
    const id = String(jobId);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 4) {
        setNotice("You can compare up to 4 jobs at a time.");
        return current;
      }
      setNotice("");
      return [...current, id];
    });
  };

  const toggleShortlist = async (job) => {
    const id = String(job._id);
    try {
      setSavingId(id);
      setError("");
      if (shortlistIds.has(id)) {
        await removeJobFromShortlist(id);
        setShortlist((current) => current.filter((item) => String(item._id) !== id));
        setNotice("Job removed from your shortlist.");
      } else {
        await addJobToShortlist(id);
        setShortlist((current) => [
          { _id: id, ...job, savedAt: new Date().toISOString(), listingAvailable: true },
          ...current,
        ]);
        setNotice("Job added to your shortlist.");
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to update your shortlist.");
    } finally {
      setSavingId("");
    }
  };

  const renderJobCard = (job) => {
    const id = String(job._id);
    const isSaved = shortlistIds.has(id);
    const isSelected = selectedIds.includes(id);
    return (
      <article className="jc-job-card" key={id}>
        <div className="jc-job-main">
          <span className="jc-source">{job.source || "Job listing"}</span>
          <h3>{job.title || "Untitled role"}</h3>
          <p className="jc-company">{job.company || "Company not specified"}</p>
          <div className="jc-meta">
            <span><MapPin size={14} />{job.location || "Location not specified"}</span>
            <span><BriefcaseBusiness size={14} />{job.workMode || (job.isRemote ? "Remote" : "Work mode not specified")}</span>
          </div>
          <div className="jc-skill-list">
            {getSkills(job).slice(0, 8).map((skill) => (
              <span key={skill} className={profileSkills.has(normalize(skill)) ? "matched" : ""}>{skill}</span>
            ))}
            {getSkills(job).length > 8 && <small>+{getSkills(job).length - 8} more</small>}
            {!getSkills(job).length && <small>Skills are not separately listed by this job source.</small>}
          </div>
        </div>
        <div className="jc-card-actions">
          <button type="button" className={isSelected ? "jc-selected" : ""} onClick={() => toggleCompare(id)}>
            {isSelected ? <Check size={15} /> : <Scale size={15} />}
            {isSelected ? "Selected" : "Compare"}
          </button>
          <button type="button" className={isSaved ? "jc-saved" : ""} disabled={savingId === id} onClick={() => toggleShortlist(job)}>
            {isSaved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
            {savingId === id ? "Saving..." : isSaved ? "Shortlisted" : "Shortlist"}
          </button>
          {getJobUrl(job) && (
            <a href={getJobUrl(job)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> View job</a>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className="job-comparison">
      <div className="jc-intro">
        <div>
          <span className="jc-kicker"><Scale size={14} /> JOB DECISION TOOLS</span>
          <h2>Compare & shortlist jobs</h2>
          <p>Choose up to four real job listings to compare their requirements with your profile, then save opportunities to your personal shortlist.</p>
        </div>
        <button type="button" className="jc-refresh" onClick={loadData} disabled={loading}>
          <RefreshCw size={15} className={loading ? "is-spinning" : ""} /> Refresh jobs
        </button>
      </div>

      <div className="jc-summary-row">
        <div><strong>{jobs.length}</strong><span>Available listings</span></div>
        <div><strong>{selectedIds.length}/4</strong><span>Selected to compare</span></div>
        <div><strong>{shortlist.length}</strong><span>Saved jobs</span></div>
      </div>

      {error && <div className="jc-alert" role="alert">{error}</div>}
      {notice && <div className="jc-notice" role="status">{notice}</div>}

      <section className="jc-section">
        <div className="jc-section-heading">
          <div><span>AVAILABLE OPPORTUNITIES</span><h3>Jobs from your JobPulse search</h3></div>
          <label className="jc-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter title, company, skill..." /></label>
        </div>
        {loading ? (
          <div className="jc-empty"><span className="skill-gap-loader" /> Loading job listings...</div>
        ) : filteredJobs.length ? (
          <div className="jc-job-list">{filteredJobs.slice(0, 30).map(renderJobCard)}</div>
        ) : (
          <div className="jc-empty">No matching job listings are available. Open Job Search to refresh your recommendations, then try again.</div>
        )}
        {!loading && filteredJobs.length > 30 && <p className="jc-footnote">Showing the first 30 of {filteredJobs.length} matching listings. Use the search field to narrow the results.</p>}
      </section>

      <section className="jc-section">
        <div className="jc-section-heading">
          <div><span>JOB COMPARISON</span><h3>Side-by-side comparison</h3></div>
          {selectedIds.length > 0 && <button type="button" className="jc-clear" onClick={() => setSelectedIds([])}><X size={14} /> Clear selection</button>}
        </div>
        {selectedJobs.length < 2 ? (
          <div className="jc-empty">Select at least 2 jobs above to compare them side by side. You can select up to 4.</div>
        ) : (
          <div className="jc-compare-wrap">
            <table className="jc-compare-table">
              <thead><tr><th>Comparison</th>{selectedJobs.map((job) => <th key={job._id}>{job.title}<small>{job.company}</small></th>)}</tr></thead>
              <tbody>
                <tr><th>Location</th>{selectedJobs.map((job) => <td key={job._id}>{job.location || "Not specified"}</td>)}</tr>
                <tr><th>Work mode</th>{selectedJobs.map((job) => <td key={job._id}>{job.workMode || (job.isRemote ? "Remote" : "Not specified")}</td>)}</tr>
                <tr><th>Experience</th>{selectedJobs.map((job) => <td key={job._id}>{job.experience || job.experienceLevel || "Not specified"}</td>)}</tr>
                <tr><th>Salary</th>{selectedJobs.map((job) => <td key={job._id}>{job.salary || "Not specified"}</td>)}</tr>
                <tr><th>Source</th>{selectedJobs.map((job) => <td key={job._id}>{job.source || "Not specified"}</td>)}</tr>
                <tr><th>Skills you have</th>{selectedJobs.map((job) => {
                  const matched = getSkills(job).filter((skill) => profileSkills.has(normalize(skill)));
                  return <td key={job._id}>{matched.length ? matched.join(", ") : "No structured matches found"}</td>;
                })}</tr>
                <tr><th>Skills to develop</th>{selectedJobs.map((job) => {
                  const missing = getSkills(job).filter((skill) => !profileSkills.has(normalize(skill)));
                  return <td key={job._id}>{missing.length ? missing.join(", ") : "No structured skill gaps found"}</td>;
                })}</tr>
                <tr><th>Job listing</th>{selectedJobs.map((job) => <td key={job._id}>{getJobUrl(job) ? <a href={getJobUrl(job)} target="_blank" rel="noreferrer">Open listing <ExternalLink size={12} /></a> : "Link unavailable"}</td>)}</tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="jc-section">
        <div className="jc-section-heading">
          <div><span>YOUR SAVED JOBS</span><h3>Shortlist</h3></div>
        </div>
        {shortlist.length ? (
          <div className="jc-job-list">{shortlist.map((job) => (
            <article className="jc-shortlist-card" key={job._id}>
              <div><h4>{job.title}</h4><p>{job.company} · {job.location}</p><small>Saved {job.savedAt ? new Date(job.savedAt).toLocaleDateString() : ""}</small></div>
              <div className="jc-shortlist-actions">
                {job.applicationUrl && <a href={job.applicationUrl} target="_blank" rel="noreferrer">Open job <ExternalLink size={13} /></a>}
                <button type="button" disabled={savingId === String(job._id)} onClick={() => toggleShortlist(job)}><X size={14} /> Remove</button>
              </div>
            </article>
          ))}</div>
        ) : (
          <div className="jc-empty">Your shortlist is empty. Save jobs above to keep them here for later.</div>
        )}
      </section>
    </section>
  );
}

export default JobComparison;
