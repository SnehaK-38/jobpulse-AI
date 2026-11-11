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
  const coverage = Number(summary.coverage || 0);
  const totalOccurrences = Number(summary.totalSkillOccurrences || 0);
  const matchedOccurrences = Number(summary.matchedOccurrences || 0);
  const missingOccurrences = Number(summary.missingOccurrences || 0);

  return (
    <>
      <Navbar dashboardMode />
      <main className="skill-gap-page">
        <section className="skill-gap-heading">
          <div>
            <span className="skill-gap-eyebrow"><Sparkles size={14} /> CAREER INTELLIGENCE</span>
            <h1>Skill Gap Analysis</h1>
            <p>See how your saved skills compare with the skills appearing in jobs related to your target role.</p>
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

        {loading && !data ? (
          <div className="skill-gap-loading"><span className="skill-gap-loader" /> Building your skill gap overview...</div>
        ) : (
          <>
            <section className="skill-gap-stats">
              <article className="skill-gap-stat">
                <span className="stat-icon violet"><BriefcaseBusiness size={19} /></span>
                <div>
                  <span>Role-matched jobs analysed</span>
                  <strong>{summary.jobsAnalysed ?? 0}</strong>
                  <small>{summary.jobsScanned ?? 0} of {summary.totalAvailableJobs ?? 0} available listings scanned</small>
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
                <div><span>High-priority gaps</span><strong>{summary.highPrioritySkills ?? 0}</strong><small>Priority score of 65 or higher</small></div>
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
                <p>Your profile skills were compared with the skills found in {summary.jobsAnalysed ?? 0} role-matched job listings.</p>
                <div className="hero-pills">
                  <span><i className="legend-dot matched-dot" /> {matchedOccurrences} matched occurrences</span>
                  <span><i className="legend-dot missing-dot" /> {missingOccurrences} missing occurrences</span>
                </div>
              </div>
              <div className="hero-total">
                <span>Total skill occurrences</span>
                <strong>{totalOccurrences}</strong>
                <small>Across the analysed listings</small>
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
                    <div className="gap-bar-value">{matchedOccurrences}</div>
                    <div className="gap-bar-track matched-track"><span style={{ height: totalOccurrences ? (matchedOccurrences / totalOccurrences) * 100 + "%" : "0%" }} /></div>
                    <strong>Matched</strong>
                    <small>{matchedSkills.length} distinct skills</small>
                  </div>
                  <div className="gap-bar-column">
                    <div className="gap-bar-value">{missingOccurrences}</div>
                    <div className="gap-bar-track missing-track"><span style={{ height: totalOccurrences ? (missingOccurrences / totalOccurrences) * 100 + "%" : "0%" }} /></div>
                    <strong>Missing</strong>
                    <small>{missingSkills.length} distinct skills</small>
                  </div>
                </div>
                <div className="coverage-track"><span style={{ width: coverage + "%" }} /></div>
                <div className="coverage-legend">
                  <span><i className="legend-dot matched-dot" />Coverage: {coverage}%</span>
                  <span><i className="legend-dot missing-dot" />Gap: {100 - coverage}%</span>
                </div>
                <div className="coverage-explainer">
                  <strong>How to read this</strong>
                  <p>{matchedOccurrences} of {totalOccurrences} skill occurrences across the analysed jobs match skills in your profile. Repeated skills in different jobs count as separate occurrences.</p>
                </div>
                <div className="target-role"><span>Target role</span><strong>{profile.targetRole || "Not set in profile"}</strong></div>
              </article>

              <article className="skill-gap-panel priority-panel">
                <div className="panel-heading">
                  <div><span className="panel-kicker">WHAT TO LEARN NEXT</span><h2>Priority skills</h2></div>
                  <span className="priority-icon"><TrendingUp size={18} /></span>
                </div>
                <p className="panel-description">Relevant missing technologies ranked using job demand, nearby requirement evidence and role relevance.</p>
                {missingSkills.length ? (
                  <div className="priority-list">
                    {missingSkills.slice(0, 8).map((skill, index) => (
                      <div className="priority-item" key={skill.name}>
                        <div className="priority-row">
                          <span className="priority-rank">{String(index + 1).padStart(2, "0")}</span>
                          <div className="priority-skill-main">
                            <strong>{skill.name}</strong>
                            <span>Appears in {skill.jobCount} {skill.jobCount === 1 ? "job" : "jobs"} · {skill.requiredCount} nearby requirement signals</span>
                          </div>
                          <div className="priority-score"><strong>{skill.priorityScore}</strong><span>/100</span></div>
                          <span className={"priority-badge " + skill.priority.toLowerCase()}>{skill.priority}</span>
                        </div>
                        <details className="priority-breakdown">
                          <summary>View score breakdown</summary>
                          <div className="breakdown-grid">
                            <BreakdownItem label="Job demand" score={skill.scoreBreakdown?.demand} weight={50} />
                            <BreakdownItem label="Requirement signals" score={skill.scoreBreakdown?.importance} weight={30} />
                            <BreakdownItem label="Role relevance" score={skill.scoreBreakdown?.roleRelevance} weight={20} />
                          </div>
                          <p className="breakdown-note">Weighted score = demand × 50% + requirement signals × 30% + role relevance × 20%.</p>
                        </details>
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
                <div><strong>{matchedSkills.length} distinct skills matched</strong><p>{matchedSkills.length ? matchedSkills.join(" · ") : "Matched skills will appear when relevant jobs contain skills from your profile."}</p></div>
              </div>
              <div className="priority-method">
                <div className="method-icon"><Activity size={18} /></div>
                <div>
                  <strong>How priority is calculated</strong>
                  <p>50% job demand · 30% requirement signals near the skill mention · 20% target-role relevance. High ≥65, Medium ≥35, Low below 35. Scores are heuristic indicators, not a guarantee of hiring outcomes.</p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function BreakdownItem({ label, score = 0, weight }) {
  const safeScore = Number(score || 0);
  return (
    <div className="breakdown-item">
      <div><span>{label}</span><strong>{safeScore}/100</strong></div>
      <div className="breakdown-track"><span style={{ width: safeScore + "%" }} /></div>
      <small>{weight}% weight · contributes {(safeScore * weight / 100).toFixed(1)} points</small>
    </div>
  );
}

export default SkillGapAnalysis;
