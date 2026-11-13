import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight, BookOpen, CheckCircle2, Clock3, ExternalLink,
  GraduationCap, ListChecks, LoaderCircle, PlayCircle, RefreshCw,
  Sparkles, Target, TrendingUp
} from "lucide-react";
import {
  generateMissingSkillsRoadmap,
  getMissingSkillsRoadmap,
  updateMissingSkillStatus
} from "../../services/skillGapService";
import "./MissingSkillsRoadmap.css";

function MissingSkillsRoadmap({ profile, missingSkills = [], jobIds = [] }) {
  const [roadmap, setRoadmap] = useState([]);
  const [savedRole, setSavedRole] = useState("");
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const targetRole = profile?.targetRole || "";
  const completedCount = roadmap.filter((item) => item.status === "Completed").length;
  const inProgressCount = roadmap.filter((item) => item.status === "In Progress").length;
  const progress = roadmap.length ? Math.round(completedCount / roadmap.length * 100) : 0;
  const hasCurrentGaps = missingSkills.length > 0 && jobIds.length > 0;
  const roadmapIsCurrent = savedRole && savedRole.toLowerCase() === targetRole.toLowerCase();

  useEffect(() => {
    let active = true;
    const loadSaved = async () => {
      try {
        setLoadingSaved(true);
        const result = await getMissingSkillsRoadmap();
        if (!active) return;
        setRoadmap(result.roadmap || []);
        setSavedRole(result.targetRole || "");
      } catch (err) {
        if (active) setError(err?.response?.data?.message || "Unable to load your saved roadmap.");
      } finally {
        if (active) setLoadingSaved(false);
      }
    };
    loadSaved();
    return () => { active = false; };
  }, []);

  const handleGenerate = async () => {
    if (!hasCurrentGaps || !targetRole) return;
    try {
      setGenerating(true);
      setError("");
      setNotice("");
      const result = await generateMissingSkillsRoadmap({ jobIds, missingSkills });
      setRoadmap(result.roadmap || []);
      setSavedRole(result.targetRole || targetRole);
      setNotice("Your roadmap has been generated using your current missing skills and the analysed job listings.");
    } catch (err) {
      setError(err?.response?.data?.message || "We could not generate your roadmap. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (itemId, status) => {
    const previous = roadmap;
    setRoadmap((items) => items.map((item) => item._id === itemId ? { ...item, status } : item));
    setUpdatingId(itemId);
    setError("");
    try {
      const result = await updateMissingSkillStatus(itemId, status);
      setRoadmap(result.roadmap || previous);
    } catch (err) {
      setRoadmap(previous);
      setError(err?.response?.data?.message || "Could not save your progress. Please try again.");
    } finally {
      setUpdatingId("");
    }
  };

  const sortedRoadmap = useMemo(
    () => [...roadmap].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [roadmap]
  );

  return (
    <section className="missing-roadmap">
      <div className="missing-roadmap-heading">
        <div>
          <span className="missing-roadmap-eyebrow"><Sparkles size={14} /> PERSONAL LEARNING PLAN</span>
          <h2>Missing Skills Roadmap</h2>
          <p>Turn the skills missing from your profile into a practical learning sequence for your target role.</p>
        </div>
        <button className="missing-roadmap-generate" onClick={handleGenerate} disabled={!hasCurrentGaps || !targetRole || generating}>
          {generating ? <LoaderCircle size={16} className="roadmap-spin" /> : <RefreshCw size={16} />}
          {generating ? "Building roadmap..." : roadmap.length ? "Regenerate roadmap" : "Generate my roadmap"}
        </button>
      </div>

      <div className="missing-roadmap-role">
        <div><span>YOUR TARGET ROLE</span><strong>{targetRole || "Set a target role in your profile"}</strong></div>
        <div><span>MISSING SKILLS IDENTIFIED</span><strong>{missingSkills.length}</strong></div>
        <div><span>JOB LISTINGS USED</span><strong>{jobIds.length}</strong></div>
      </div>

      {error && <div className="missing-roadmap-alert" role="alert">{error}</div>}
      {notice && <div className="missing-roadmap-notice"><CheckCircle2 size={16} />{notice}</div>}

      {loadingSaved ? (
        <div className="missing-roadmap-empty"><LoaderCircle size={20} className="roadmap-spin" /> Loading your saved learning progress...</div>
      ) : !hasCurrentGaps ? (
        <div className="missing-roadmap-empty">
          <Target size={25} />
          <strong>{missingSkills.length ? "Refresh your job analysis" : "No missing skills found yet"}</strong>
          <p>{missingSkills.length ? "Refresh Skill Gap Analysis so JobPulse can use the latest job listings." : "Once Skill Gap Analysis identifies missing skills for your target role, you can turn them into a learning plan here."}</p>
        </div>
      ) : roadmap.length && !roadmapIsCurrent ? (
        <div className="missing-roadmap-stale">
          Your saved roadmap is for <strong>{savedRole}</strong>, but your current target role is <strong>{targetRole}</strong>. Generate a new roadmap to update it.
        </div>
      ) : roadmap.length === 0 ? (
        <div className="missing-roadmap-empty">
          <GraduationCap size={27} />
          <strong>Your learning roadmap is ready to be created</strong>
          <p>JobPulse has identified {missingSkills.length} missing skills. Generate a roadmap to organise them by job demand, learning dependencies and practical exercises.</p>
          <button className="missing-roadmap-inline-button" onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating..." : "Create learning roadmap"} <ArrowUpRight size={15} />
          </button>
        </div>
      ) : (
        <>
          <div className="missing-roadmap-progress">
            <div className="missing-roadmap-progress-top">
              <div><span>YOUR LEARNING PROGRESS</span><strong>{progress}% completed</strong></div>
              <span>{completedCount} of {roadmap.length} skills completed</span>
            </div>
            <div className="missing-roadmap-progress-track"><span style={{ width: progress + "%" }} /></div>
            <div className="missing-roadmap-progress-legend">
              <span><i className="roadmap-dot completed" />{completedCount} completed</span>
              <span><i className="roadmap-dot active" />{inProgressCount} in progress</span>
              <span><i className="roadmap-dot pending" />{roadmap.length - completedCount - inProgressCount} not started</span>
            </div>
          </div>

          <div className="missing-roadmap-explainer">
            <TrendingUp size={17} />
            <p>Priority is based on how often a skill appears in your analysed job listings and how often listings explicitly describe it as required. Learning order also considers prerequisite skills.</p>
          </div>

          <div className="missing-roadmap-list">
            {sortedRoadmap.map((item, index) => (
              <article className={`missing-roadmap-card ${item.status === "Completed" ? "is-completed" : ""}`} key={item._id || item.skill}>
                <div className="missing-roadmap-card-top">
                  <div className="missing-roadmap-step">{String(index + 1).padStart(2, "0")}</div>
                  <div className="missing-roadmap-skill-title">
                    <span className="missing-roadmap-kicker">LEARNING STEP {index + 1}</span>
                    <h3>{item.skill}</h3>
                    <div className="missing-roadmap-evidence">
                      <span>{item.jobCount} of {jobIds.length} listings mention this skill</span>
                      <span>{item.requiredCount} explicitly mark it as required</span>
                    </div>
                  </div>
                  <span className={`missing-roadmap-priority ${(item.priority || "Medium").toLowerCase()}`}>{item.priority} priority</span>
                </div>

                <p className="missing-roadmap-reason">{item.reason}</p>

                {item.prerequisites?.length > 0 && (
                  <div className="missing-roadmap-prerequisites"><strong>Learn first:</strong> {item.prerequisites.join(", ")}</div>
                )}

                <div className="missing-roadmap-detail-grid">
                  <div className="missing-roadmap-detail">
                    <h4><ListChecks size={15} /> What to learn</h4>
                    <ul>{(item.topics || []).map((topic) => <li key={topic}>{topic}</li>)}</ul>
                  </div>
                  <div className="missing-roadmap-detail">
                    <h4><Clock3 size={15} /> Suggested time</h4>
                    <strong className="missing-roadmap-duration">{item.estimatedWeeks} {item.estimatedWeeks === 1 ? "week" : "weeks"}</strong>
                    <span>Approximate estimate at 5–7 study hours per week.</span>
                  </div>
                </div>

                <div className="missing-roadmap-resources">
                  <h4><BookOpen size={15} /> Recommended learning resources</h4>
                  <div className="missing-roadmap-resource-grid">
                    {(item.resources || []).map((resource) => (
                      <a className="missing-roadmap-resource" href={resource.url} target="_blank" rel="noreferrer" key={resource.url}>
                        <span>{resource.provider} · {resource.type}</span>
                        <strong>{resource.title}</strong>
                        <small>Open learning resource <ExternalLink size={12} /></small>
                      </a>
                    ))}
                  </div>
                </div>

                {item.practiceTask && (
                  <div className="missing-roadmap-practice">
                    <strong><PlayCircle size={15} /> Practical task</strong>
                    <p>{item.practiceTask}</p>
                  </div>
                )}

                <div className="missing-roadmap-card-footer">
                  <label htmlFor={`roadmap-status-${item._id}`}>Learning status</label>
                  <select id={`roadmap-status-${item._id}`} value={item.status || "Not Started"} disabled={updatingId === item._id} onChange={(event) => handleStatusChange(item._id, event.target.value)}>
                    <option>Not Started</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                  </select>
                  {updatingId === item._id && <span className="missing-roadmap-saving">Saving...</span>}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default MissingSkillsRoadmap;
