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
} from "lucide-react";
import Navbar from "../../components/Navbar/Navbar";
import { getSkillGapOverview } from "../../services/skillGapService";
import "./SkillGapAnalysis.css";

function SkillGapAnalysis() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAnalysis = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await getSkillGapOverview();
      setData(result);
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
  const matchedSkills = data?.matchedSkills || [];

  return (
    <>
      <Navbar dashboardMode />
      <main className="skill-gap-page">
        <section className="skill-gap-heading">
          <div>
            <span className="skill-gap-eyebrow"><Sparkles size={14} /> CAREER INTELLIGENCE</span>
            <h1>Skill Gap Analysis</h1>
            <p>Understand how your current skills compare with the requirements of jobs matching your target role.</p>
          </div>
          <button className="skill-gap-refresh" onClick={loadAnalysis} disabled={loading}>
            <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
            {loading ? "Analysing..." : "Refresh analysis"}
          </button>
        </section>

        {error && (
          <div className="skill-gap-alert" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <section className="skill-gap-stats">
          <article className="skill-gap-stat">
            <span className="stat-icon violet"><Activity size={19} /></span>
            <div><span>Jobs analysed</span><strong>{loading ? "—" : summary.jobsAnalysed ?? 0}</strong></div>
          </article>
          <article className="skill-gap-stat">
            <span className="stat-icon green"><CheckCircle2 size={19} /></span>
            <div><span>Matched skills</span><strong>{loading ? "—" : summary.matchedSkills ?? 0}</strong></div>
          </article>
          <article className="skill-gap-stat">
            <span className="stat-icon orange"><Target size={19} /></span>
            <div><span>Skill gaps found</span><strong>{loading ? "—" : summary.missingSkills ?? 0}</strong></div>
          </article>
          <article className="skill-gap-stat">
            <span className="stat-icon red"><TrendingUp size={19} /></span>
            <div><span>High-priority gaps</span><strong>{loading ? "—" : summary.highPrioritySkills ?? 0}</strong></div>
          </article>
        </section>

        {loading && !data ? (
          <div className="skill-gap-loading"><span className="skill-gap-loader" /> Building your skill gap overview...</div>
        ) : (
          <>
            {data?.message && (
              <div className="skill-gap-empty">
                <CircleHelp size={22} />
                <div><strong>More job data is needed</strong><p>{data.message}</p></div>
              </div>
            )}

            <section className="skill-gap-grid">
              <article className="skill-gap-panel current-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">YOUR PROFILE</span><h2>Current skills</h2></div>
                  <span className="panel-count">{currentSkills.length}</span>
                </div>
                <p className="panel-description">Skills currently available in your saved profile and parsed resume.</p>
                {currentSkills.length ? (
                  <div className="skill-chip-list">
                    {currentSkills.map((skill) => <span className="current-skill-chip" key={skill}><CheckCircle2 size={13} />{skill}</span>)}
                  </div>
                ) : (
                  <div className="panel-empty">No skills found. Upload or update your resume to populate this section.</div>
                )}
                <div className="panel-footnote"><ShieldCheck size={15} /> Proficiency levels are not assumed from skill names.</div>
              </article>

              <article className="skill-gap-panel coverage-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">ROLE COMPATIBILITY</span><h2>Skill coverage</h2></div>
                  <span className="coverage-icon"><Target size={18} /></span>
                </div>
                <div className="coverage-number">{summary.coverage ?? 0}<small>%</small></div>
                <p className="panel-description">Your current skills matched against skills found in the analysed job listings.</p>
                <div className="coverage-track"><span style={{ width: `${Math.max(0, Math.min(100, summary.coverage || 0))}%` }} /></div>
                <div className="coverage-legend"><span><i className="legend-dot matched-dot" />Matched skills: {matchedSkills.length}</span><span><i className="legend-dot missing-dot" />Missing skills: {missingSkills.length}</span></div>
                <div className="target-role"><span>Target role</span><strong>{profile.targetRole || "Not set in profile"}</strong></div>
              </article>

              <article className="skill-gap-panel priority-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">WHAT TO LEARN NEXT</span><h2>Priority skills</h2></div>
                  <span className="priority-icon"><TrendingUp size={18} /></span>
                </div>
                <p className="panel-description">Skills ranked by demand across analysed jobs, explicit requirement signals and target-role relevance.</p>
                {missingSkills.length ? (
                  <div className="priority-list">
                    {missingSkills.slice(0, 8).map((skill, index) => (
                      <div className="priority-row" key={skill.name}>
                        <span className="priority-rank">{String(index + 1).padStart(2, "0")}</span>
                        <div className="priority-skill-main"><strong>{skill.name}</strong><span>Appears in {skill.jobCount} {skill.jobCount === 1 ? "job" : "jobs"}</span></div>
                        <div className="priority-score"><strong>{skill.priorityScore}</strong><span>/100</span></div>
                        <span className={`priority-badge ${skill.priority.toLowerCase()}`}>{skill.priority}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel-empty">No missing skills were identified from the available job data.</div>
                )}
                {missingSkills.length > 8 && <p className="priority-more">Showing the 8 highest-priority gaps out of {missingSkills.length}.</p>}
              </article>
            </section>

            <section className="skill-gap-bottom">
              <div className="matched-summary">
                <div className="matched-summary-icon"><CheckCircle2 size={19} /></div>
                <div><strong>{matchedSkills.length} skills matched</strong><p>{matchedSkills.length ? matchedSkills.join(" · ") : "Matched skills will appear when relevant jobs contain skills from your profile."}</p></div>
              </div>
              <div className="priority-method">
                <div className="method-icon"><ArrowUpRight size={18} /></div>
                <div><strong>How priority is calculated</strong><p>50% job demand · 30% explicit requirement signals · 20% target-role relevance. Scores are calculated from the currently available job listings.</p></div>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

export default SkillGapAnalysis;
