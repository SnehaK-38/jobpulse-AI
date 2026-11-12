import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  BriefcaseBusiness,
  Layers3,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Navbar from "../../components/Navbar/Navbar";
import JobComparison from "./JobComparison";
import { getSkillGapOverview } from "../../services/skillGapService";
import "./SkillGapAnalysis.css";

function SkillGapAnalysis() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [priorityPage, setPriorityPage] = useState(0);
  const [activeView, setActiveView] = useState("overview");

  const loadAnalysis = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await getSkillGapOverview();
      setData(result);
      setPriorityPage(0);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        "We could not load your skill gap analysis. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  const profile = data?.profile || {};
  const summary = data?.summary || {};
  const currentSkills = profile.currentSkills || [];
  const missingSkills = data?.missingSkills || [];
  const priorityPageSize = 5;
  const priorityPageCount = Math.ceil(missingSkills.length / priorityPageSize);
  const visiblePrioritySkills = missingSkills.slice(
    priorityPage * priorityPageSize,
    (priorityPage + 1) * priorityPageSize
  );
  const matchedSkills = data?.matchedSkills || [];
  const coverage = Number(summary.coverage || 0);
  const totalDistinctJobSkills = Number(summary.totalDistinctJobSkills || 0);

  return (
    <>
      <Navbar dashboardMode />
      <main className="skill-gap-page">
        <section className="skill-gap-heading">
          <div>
            <span className="skill-gap-eyebrow"><Sparkles size={14} /> CAREER INTELLIGENCE</span>
            <h1>Career Tools</h1>
            <p>Understand your skill gaps and compare job opportunities to make informed career decisions.</p>
          </div>
          {activeView === "overview" && (
            <button className="skill-gap-refresh" onClick={loadAnalysis} disabled={loading}>
              <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
              {loading ? "Analysing..." : "Refresh analysis"}
            </button>
          )}
        </section>

        <nav className="skill-gap-view-tabs" aria-label="Career tools sections">
          <button type="button" className={activeView === "overview" ? "active" : ""} onClick={() => setActiveView("overview")} aria-current={activeView === "overview" ? "page" : undefined}>
            <Layers3 size={15} /> Skill Gap Analysis
          </button>
          <button type="button" className={activeView === "comparison" ? "active" : ""} onClick={() => setActiveView("comparison")} aria-current={activeView === "comparison" ? "page" : undefined}>
            <BriefcaseBusiness size={15} /> Job Comparison & Shortlisting
          </button>
        </nav>

        {error && activeView === "overview" && (
          <div className="skill-gap-alert" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {activeView === "comparison" ? (
          <JobComparison analysis={data} />
        ) : loading && !data ? (
          <div className="skill-gap-loading"><span className="skill-gap-loader" /> Building your skill gap overview...</div>
        ) : (
          <>
            <section className="skill-gap-stats">
              <article className="skill-gap-stat">
                <span className="stat-icon violet"><BriefcaseBusiness size={19} /></span>
                <div>
                  <span>Role-related jobs analysed</span>
                  <strong>{summary.jobsAnalysed ?? 0}</strong>
                  <small>Same {summary.jobsScanned ?? 0} listings returned by Job Search</small>
                </div>
              </article>
              <article className="skill-gap-stat">
                <span className="stat-icon green"><CheckCircle2 size={19} /></span>
                <div><span>Matched skills</span><strong>{summary.matchedSkills ?? 0}</strong><small>Distinct skills found in your profile and jobs</small></div>
              </article>
              <article className="skill-gap-stat">
                <span className="stat-icon orange"><Target size={19} /></span>
                <div><span>Skill gaps found</span><strong>{summary.missingSkills ?? 0}</strong><small>Distinct relevant skills not in your profile</small></div>
              </article>
              <article className="skill-gap-stat">
                <span className="stat-icon red"><TrendingUp size={19} /></span>
                <div><span>Skill coverage</span><strong>{coverage}%</strong><small>Share of distinct job skills in your profile</small></div>
              </article>
            </section>

            {data?.message && (
              <div className="skill-gap-empty">
                <CircleHelp size={22} />
                <div><strong>More job data is needed</strong><p>{data.message}</p></div>
              </div>
            )}

            <section className="skill-gap-hero">
              <div className="hero-score-wrap">
                <div className="hero-score-ring" style={{ "--coverage": coverage + "%" }}>
                  <div><strong>{coverage}%</strong><span>Skill coverage</span></div>
                </div>
              </div>
              <div className="hero-copy">
                <span className="hero-kicker">PROFILE VS JOB REQUIREMENTS</span>
                <h2>{profile.targetRole || "Target role not set"}</h2>
                <p>Your profile skills were compared with the skills found in {summary.jobsAnalysed ?? 0} role-related job listings.</p>
                <div className="hero-pills">
                  <span><i className="legend-dot matched-dot" /> {matchedSkills.length} distinct matched skills</span>
                  <span><i className="legend-dot missing-dot" /> {missingSkills.length} distinct missing skills</span>
                </div>
              </div>
              <div className="hero-total">
                <span>Distinct skills found in jobs</span>
                <strong>{totalDistinctJobSkills}</strong>
                <small>Each skill counted once</small>
              </div>
            </section>

            <section className="skill-gap-grid">
              <article className="skill-gap-panel current-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">YOUR PROFILE</span><h2>Current skills</h2></div>
                  <span className="panel-count">{currentSkills.length}</span>
                </div>
                <p className="panel-description">Skills currently saved in your profile or extracted from your resume.</p>
                {currentSkills.length ? (
                  <div className="skill-chip-list">
                    {currentSkills.map((skill) => (
                      <span className="current-skill-chip" key={skill}><CheckCircle2 size={13} />{skill}</span>
                    ))}
                  </div>
                ) : (
                  <div className="panel-empty">No skills found. Upload or update your resume to populate this section.</div>
                )}
                <div className="panel-footnote"><ShieldCheck size={15} /> Proficiency levels are not assumed from skill names.</div>
              </article>

              <article className="skill-gap-panel coverage-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">SKILL GAP OVERVIEW</span><h2>Profile vs job skills</h2></div>
                  <span className="coverage-icon"><Layers3 size={18} /></span>
                </div>
                <div className="gap-bars">
                  <div className="gap-bar-column">
                    <div className="gap-bar-value">{matchedSkills.length}</div>
                    <div className="gap-bar-track matched-track"><span style={{ height: totalDistinctJobSkills ? (matchedSkills.length / totalDistinctJobSkills) * 100 + "%" : "0%" }} /></div>
                    <strong>Matched</strong>
                    <small>Distinct skills</small>
                  </div>
                  <div className="gap-bar-column">
                    <div className="gap-bar-value">{missingSkills.length}</div>
                    <div className="gap-bar-track missing-track"><span style={{ height: totalDistinctJobSkills ? (missingSkills.length / totalDistinctJobSkills) * 100 + "%" : "0%" }} /></div>
                    <strong>Missing</strong>
                    <small>Distinct skills</small>
                  </div>
                </div>
                <div className="coverage-track"><span style={{ width: coverage + "%" }} /></div>
                <div className="coverage-legend">
                  <span><i className="legend-dot matched-dot" />Coverage: {coverage}%</span>
                  <span><i className="legend-dot missing-dot" />Gap: {100 - coverage}%</span>
                </div>
                <div className="coverage-explainer">
                  <strong>How to read this</strong>
                  <p>{matchedSkills.length} of {totalDistinctJobSkills} distinct skills found across the analysed job listings are already in your profile. Each normalized skill is counted once, even when it appears in multiple jobs.</p>
                </div>
                <div className="target-role"><span>Target role</span><strong>{profile.targetRole || "Not set in profile"}</strong></div>
              </article>

              <article className="skill-gap-panel priority-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">WHAT TO LEARN NEXT</span><h2>Priority skills</h2></div>
                  <span className="priority-icon"><TrendingUp size={18} /></span>
                </div>
                <p className="panel-description">Missing technical skills ranked by the number of job listings containing them, requirement evidence and relevance to your target role.</p>
                {missingSkills.length ? (
                  <div className="priority-list">
                    {visiblePrioritySkills.map((skill, index) => (
                      <div className="priority-item" key={skill.name}>
                        <div className="priority-row">
                          <span className="priority-rank">{String(priorityPage * priorityPageSize + index + 1).padStart(2, "0")}</span>
                          <div className="priority-skill-main">
                            <strong>{skill.name}</strong>
                            <span>Found in {skill.jobCount} {skill.jobCount === 1 ? "job listing" : "job listings"}</span>
                            <span className="priority-requirement-count">
                              Listed as required or preferred: {skill.requiredCount} of {skill.jobCount}
                            </span>
                          </div>
                          <span className={`priority-badge ${(skill.priority || "Low").toLowerCase()}`}>{skill.priority || "Low"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel-empty">No missing technical skills were identified in the current job results.</div>
                )}
                {priorityPageCount > 1 && (
                  <div className="priority-pagination">
                    <span>Showing {priorityPage * priorityPageSize + 1}–{Math.min((priorityPage + 1) * priorityPageSize, missingSkills.length)} of {missingSkills.length} skills</span>
                    <div className="priority-pagination-actions">
                      <button type="button" onClick={() => setPriorityPage((page) => Math.max(0, page - 1))} disabled={priorityPage === 0} aria-label="Previous skills"><ChevronLeft size={17} /></button>
                      <span>{priorityPage + 1} / {priorityPageCount}</span>
                      <button type="button" onClick={() => setPriorityPage((page) => Math.min(priorityPageCount - 1, page + 1))} disabled={priorityPage >= priorityPageCount - 1} aria-label="Next skills"><ChevronRight size={17} /></button>
                    </div>
                  </div>
                )}
              </article>
            </section>

            <section className="skill-gap-bottom">
              <div className="matched-summary">
                <div className="matched-summary-icon"><CheckCircle2 size={19} /></div>
                <div><strong>{matchedSkills.length} distinct skills matched</strong><p>{matchedSkills.length ? matchedSkills.join(" · ") : "Matched skills will appear when relevant jobs contain skills from your profile."}</p></div>
              </div>
              <div className="priority-method">
                <div className="method-icon"><Activity size={18} /></div>
                <div>
                  <strong>How skills are ordered</strong>
                  <p>Each skill is counted at most once per job listing. Ranking uses the number of listings mentioning the skill, the number with requirement evidence close to the skill name, and the average relevance of those listings to your target role. High, Medium and Low labels are assigned by relative rank within the current results.</p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}


export default SkillGapAnalysis;
