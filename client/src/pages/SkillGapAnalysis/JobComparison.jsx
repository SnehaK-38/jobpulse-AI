import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookmarkCheck,
  BriefcaseBusiness,
  Check,
  ExternalLink,
  MapPin,
  RefreshCw,
  Scale,
  X,
} from "lucide-react";
import { getProfile } from "../../services/profileService";
import { getJobShortlist, removeJobFromShortlist } from "../../services/jobShortlistService";
import "./JobComparison.css";

const clean = (value) => String(value ?? "").trim();
const normalize = (value) => {
  const skill = clean(value).toLowerCase().replace(/\\s+/g, " ");
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
    ai: "artificial intelligence",
    express: "express.js",
    "express js": "express.js",
    tailwind: "tailwind css",
    powerbi: "power bi",
    "scikit learn": "scikit-learn",
    "restful api": "rest api",
  };
  return aliases[skill] || skill;
};

const getSkills = (job) => [...new Set([
  ...(Array.isArray(job.skills) ? job.skills : []),
  ...(Array.isArray(job.detectedJobSkills) ? job.detectedJobSkills : []),
].map(clean).filter(Boolean))];

const getJobUrl = (job) => job.applicationUrl || job.jobUrlDirect || job.jobUrl || "";

function JobComparison({ analysis }) {
  const [shortlist, setShortlist] = useState([]);
  const [savedProfileSkills, setSavedProfileSkills] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [comparisonVisible, setComparisonVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [shortlistResult, profileResult] = await Promise.all([
        getJobShortlist(),
        getProfile(),
      ]);
      const savedJobs = Array.isArray(shortlistResult?.jobs) ? shortlistResult.jobs : [];
      setShortlist(savedJobs);
      setSelectedIds((current) => current.filter((id) => savedJobs.some((job) => String(job._id) === id)));
      const user = profileResult?.user || {};
      setSavedProfileSkills([
        ...(Array.isArray(user.resumeSkills) ? user.resumeSkills : []),
        ...(Array.isArray(user.skills) ? user.skills : []),
      ]);
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to load your saved jobs. Please try again.");
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

  const selectedJobs = useMemo(
    () => selectedIds.map((id) => shortlist.find((job) => String(job._id) === id)).filter(Boolean),
    [shortlist, selectedIds]
  );

  const toggleCompare = (jobId) => {
    const id = String(jobId);
    setComparisonVisible(false);
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 4) {
        setNotice("You can compare up to 4 saved jobs at a time.");
        return current;
      }
      setNotice("");
      return [...current, id];
    });
  };

  const removeSavedJob = async (job) => {
    const id = String(job._id);
    try {
      setSavingId(id);
      setError("");
      await removeJobFromShortlist(id);
      setShortlist((current) => current.filter((item) => String(item._id) !== id));
      setSelectedIds((current) => current.filter((item) => item !== id));
      setNotice("Job removed from your saved jobs.");
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to remove this saved job.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <section className="job-comparison">
      <div className="jc-intro">
        <div>
          <span className="jc-kicker"><BookmarkCheck size={14} /> YOUR CAREER SAVES</span>
          <h2>Saved Jobs</h2>
          <p>Your shortlisted opportunities are collected here. Select 2–4 saved jobs to compare their requirements with your profile.</p>
        </div>
        <button type="button" className="jc-refresh" onClick={loadData} disabled={loading}>
          <RefreshCw size={15} className={loading ? "is-spinning" : ""} /> Refresh saved jobs
        </button>
      </div>

      <div className="jc-summary-row">
        <div><strong>{shortlist.length}</strong><span>Saved jobs</span></div>
        <div><strong>{selectedIds.length}/4</strong><span>Selected to compare</span></div>
      </div>

      {error && <div className="jc-alert" role="alert">{error}</div>}
      {notice && <div className="jc-notice" role="status">{notice}</div>}

      <section className="jc-section">
        <div className="jc-section-heading">
          <div><span>YOUR SHORTLIST</span><h3>Jobs you've saved from the dashboard</h3></div>
          {selectedIds.length > 0 && <div className="jc-selection-actions">
            {selectedIds.length >= 2 && <button type="button" className="jc-compare-selected" onClick={() => setComparisonVisible(true)}><Scale size={14} /> Compare Selected ({selectedIds.length})</button>}
            {selectedIds.length > 0 && <button type="button" className="jc-clear" onClick={() => { setSelectedIds([]); setComparisonVisible(false); }}><X size={14} /> Clear selection</button>}
          </div>}
        </div>
        {loading ? (
          <div className="jc-empty"><span className="skill-gap-loader" /> Loading your saved jobs...</div>
        ) : shortlist.length ? (
          <div className="jc-job-list">
            {shortlist.map((job) => {
              const id = String(job._id);
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
                    <small className="jc-saved-date">Saved {job.savedAt ? new Date(job.savedAt).toLocaleDateString() : ""}</small>
                  </div>
                  <div className="jc-card-actions">
                    <button type="button" className={isSelected ? "jc-selected" : ""} onClick={() => toggleCompare(id)}>
                      {isSelected ? <Check size={15} /> : <Scale size={15} />}
                      {isSelected ? "Selected" : "Select to compare"}
                    </button>
                    {getJobUrl(job) && (
                      <a href={getJobUrl(job)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> View job</a>
                    )}
                    <button type="button" className="jc-remove-saved" disabled={savingId === id} onClick={() => removeSavedJob(job)}>
                      <X size={14} /> {savingId === id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="jc-empty">You haven't saved any jobs yet. Go to the dashboard and select Save Job on opportunities you want to revisit.</div>
        )}
      </section>

      <section className="jc-section">
        <div className="jc-section-heading">
          <div><span>JOB COMPARISON</span><h3>Compare saved jobs</h3></div>
        </div>
        {selectedJobs.length < 2 ? (
          <div className="jc-empty">Select at least 2 saved jobs above to compare them side by side. You can select up to 4.</div>
        ) : !comparisonVisible ? (
          <div className="jc-empty">You have selected {selectedJobs.length} jobs. Click Compare Selected above to view the side-by-side comparison.</div>
        ) : (
          <div className="jc-compare-wrap">
            <table className="jc-compare-table">
              <thead><tr><th>Comparison</th>{selectedJobs.map((job) => <th key={job._id}>{job.title}<small>{job.company}</small></th>)}</tr></thead>
              <tbody>
                <tr><th>Location</th>{selectedJobs.map((job) => <td key={job._id}>{job.location || "Not specified"}</td>)}</tr>
                <tr><th>Work mode</th>{selectedJobs.map((job) => <td key={job._id}>{job.workMode || (job.isRemote ? "Remote" : "Not specified")}</td>)}</tr>
                <tr><th>Experience</th>{selectedJobs.map((job) => <td key={job._id}>{job.experience || job.experienceLevel || "Not specified"}</td>)}</tr>
                <tr><th>Listed requirements</th>{selectedJobs.map((job) => {
                  const requirements = clean(job.requirements || job.qualifications || "");
                  return <td key={job._id}>{requirements ? (requirements.length > 360 ? requirements.slice(0, 360) + "…" : requirements) : "Not provided by this listing"}</td>;
                })}</tr>
                <tr><th>Salary</th>{selectedJobs.map((job) => <td key={job._id}>{job.salary || "Not specified"}</td>)}</tr>
                <tr><th>Source</th>{selectedJobs.map((job) => <td key={job._id}>{job.source || "Not specified"}</td>)}</tr>
                <tr><th>Skills you have</th>{selectedJobs.map((job) => {
                  const matched = getSkills(job).filter((skill) => profileSkills.has(normalize(skill)));
                  return <td key={job._id}>{matched.length ? matched.join(", ") : "No structured matches found"}</td>;
                })}</tr>
                <tr><th>Missing listed skills</th>{selectedJobs.map((job) => {
                  const missing = getSkills(job).filter((skill) => !profileSkills.has(normalize(skill)));
                  return <td key={job._id}>{missing.length ? missing.join(", ") : "No structured skill gaps found"}</td>;
                })}</tr>
                <tr><th>Job listing</th>{selectedJobs.map((job) => <td key={job._id}>{getJobUrl(job) ? <a href={getJobUrl(job)} target="_blank" rel="noreferrer">Open listing <ExternalLink size={12} /></a> : "Link unavailable"}</td>)}</tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

export default JobComparison;
