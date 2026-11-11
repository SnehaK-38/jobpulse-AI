import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  GraduationCap,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  Route,
  Sparkles,
  Youtube,
} from "lucide-react";
import {
  generateCareerRoadmap,
  getCareerRoadmap,
  updateCareerSkillStatus,
} from "../../services/careerRoadmapService";
import "./CareerRoadmap.css";

const STATUS_OPTIONS = ["Not Started", "In Progress", "Completed"];

function CareerRoadmap({ analysis }) {
  const [roadmap, setRoadmap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [expandedSkills, setExpandedSkills] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRoadmap = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await getCareerRoadmap();
      setRoadmap(result.roadmap || null);
      if (result.roadmap && result.roadmap.skills && result.roadmap.skills.length) {
        setExpandedSkills([result.roadmap.skills[0]._id]);
      }
    } catch (err) {
      setError(err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : "We could not load your saved career roadmap.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoadmap();
  }, [loadRoadmap]);

  const missingSkills = analysis && Array.isArray(analysis.missingSkills) ? analysis.missingSkills : [];
  const currentRole = analysis && analysis.profile ? analysis.profile.targetRole || "" : "";
  const savedSkillNames = useMemo(
    () => (roadmap && Array.isArray(roadmap.skills) ? roadmap.skills.map((skill) => skill.name.toLowerCase()).sort() : []),
    [roadmap]
  );
  const currentSkillNames = useMemo(
    () => missingSkills.map((skill) => String(skill.name || "").toLowerCase()).sort(),
    [missingSkills]
  );
  const needsRefresh = Boolean(
    roadmap && (
      roadmap.targetRole !== currentRole ||
      JSON.stringify(savedSkillNames) !== JSON.stringify(currentSkillNames)
    )
  );

  const completedCount = (roadmap && roadmap.skills ? roadmap.skills : [])
    .filter((skill) => skill.status === "Completed").length;
  const totalCount = roadmap && roadmap.skills ? roadmap.skills.length : 0;
  const progress = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleGenerate = async () => {
    if (!missingSkills.length) {
      setError("No missing skills are available. Refresh Skill Gap Analysis after updating your profile or job results.");
      return;
    }
    try {
      setGenerating(true);
      setError("");
      setNotice("");
      const result = await generateCareerRoadmap(currentRole, missingSkills);
      setRoadmap(result.roadmap);
      const firstSkill = result.roadmap && result.roadmap.skills && result.roadmap.skills[0];
      setExpandedSkills(firstSkill ? [firstSkill._id] : []);
      setNotice("Your personalized learning path has been generated and saved.");
    } catch (err) {
      setError(err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : "We could not generate your learning path. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (skillId, status) => {
    try {
      setSavingId(skillId);
      setError("");
      const result = await updateCareerSkillStatus(skillId, status);
      setRoadmap(result.roadmap);
    } catch (err) {
      setError(err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : "We could not save this progress update.");
    } finally {
      setSavingId("");
    }
  };

  const toggleSkill = (skillId) => {
    setExpandedSkills((current) => current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : [...current, skillId]);
  };

  return (
    <section className="career-roadmap">
      <div className="roadmap-heading">
        <div>
          <span className="roadmap-eyebrow"><Route size={14} /> PERSONALIZED LEARNING PATH</span>
          <h2>Career Roadmap</h2>
          <p>Follow a suggested sequence, explore study notes and resources, and keep track of your learning progress.</p>
        </div>
        <button className="roadmap-generate-button" type="button" onClick={handleGenerate}
          disabled={generating || loading || !missingSkills.length}>
          {generating ? <LoaderCircle size={16} className="roadmap-spin" /> : <Sparkles size={16} />}
          {generating ? "Generating..." : roadmap ? "Regenerate roadmap" : "Generate roadmap"}
        </button>
      </div>

      {error && <div className="roadmap-alert" role="alert"><AlertCircle size={17} />{error}</div>}
      {notice && <div className="roadmap-notice" role="status"><CheckCircle2 size={17} />{notice}</div>}

      {loading ? (
        <div className="roadmap-loading"><LoaderCircle className="roadmap-spin" size={22} /> Loading your saved roadmap...</div>
      ) : !roadmap ? (
        <div className="roadmap-empty">
          <div className="roadmap-empty-icon"><GraduationCap size={28} /></div>
          <h3>Your learning path starts here</h3>
          <p>Generate a roadmap from the missing skills already identified in your Skill Gap Analysis. Gemini will create a suggested topic sequence and study notes for your target role.</p>
          <small>{missingSkills.length} missing skills available for your current analysis</small>
          <button type="button" onClick={handleGenerate} disabled={generating || !missingSkills.length}>
            {generating ? "Generating your roadmap..." : "Create my learning path"}
          </button>
          {!missingSkills.length && <small>Refresh Skill Gap Analysis first if you expect missing skills here.</small>}
        </div>
      ) : (
        <>
          <div className="roadmap-summary">
            <div className="roadmap-summary-copy">
              <span>YOUR TARGET ROLE</span>
              <strong>{roadmap.targetRole}</strong>
              <small>{totalCount} skills in this suggested learning path</small>
            </div>
            <div className="roadmap-progress">
              <div className="roadmap-progress-top"><span>Learning progress</span><strong>{progress}%</strong></div>
              <div className="roadmap-progress-track"><span style={{ width: progress + "%" }} /></div>
              <small>{completedCount} of {totalCount} skills completed</small>
            </div>
          </div>

          {needsRefresh && (
            <div className="roadmap-stale">
              <RefreshCw size={16} />
              <span>Your target role or missing skills have changed since this roadmap was generated. Regenerate it to use the latest analysis. Progress for skills that remain will be preserved.</span>
            </div>
          )}

          <div className="roadmap-disclaimer">
            <Sparkles size={15} />
            This is an AI-generated suggested learning path, not a complete or official syllabus. Check the linked documentation for authoritative coverage.
          </div>

          <div className="roadmap-path">
            {roadmap.skills.slice().sort((a, b) => a.order - b.order).map((skill, index) => {
              const expanded = expandedSkills.includes(skill._id);
              return (
                <article className="roadmap-skill-card" key={skill._id}>
                  <div className="roadmap-step-marker">{index + 1}</div>
                  <div className="roadmap-skill-content">
                    <div className="roadmap-skill-top">
                      <div className="roadmap-skill-title">
                        <div className="roadmap-skill-labels">
                          <span className={"roadmap-priority " + String(skill.priority || "Low").toLowerCase()}>{skill.priority || "Low"} priority</span>
                          {skill.prerequisites && skill.prerequisites.length > 0 && <span className="roadmap-prerequisite">Prerequisites: {skill.prerequisites.join(", ")}</span>}
                        </div>
                        <h3>{skill.name}</h3>
                        {skill.reason && <p>{skill.reason}</p>}
                      </div>
                      <div className="roadmap-status-control">
                        <label htmlFor={"roadmap-status-" + skill._id}>Learning status</label>
                        <select id={"roadmap-status-" + skill._id} value={skill.status || "Not Started"}
                          disabled={savingId === skill._id}
                          onChange={(event) => handleStatusChange(skill._id, event.target.value)}>
                          {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                        {savingId === skill._id && <small>Saving...</small>}
                      </div>
                    </div>

                    <button className="roadmap-expand-button" type="button" onClick={() => toggleSkill(skill._id)}>
                      <span><BookOpen size={15} /> {skill.topics.length} learning topics and study notes</span>
                      {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
                    </button>

                    {expanded && (
                      <div className="roadmap-topic-list">
                        {skill.topics.map((topic, topicIndex) => (
                          <section className="roadmap-topic" key={topic._id || topic.title}>
                            <div className="roadmap-topic-heading">
                              <span>{index + 1}.{topicIndex + 1}</span>
                              <h4>{topic.title}</h4>
                              <small><Clock3 size={12} /> {topic.estimatedHours || 1} hrs</small>
                            </div>
                            {topic.overview && <p className="roadmap-topic-overview">{topic.overview}</p>}
                            <div className="roadmap-notes">
                              <strong>Study notes</strong>
                              <p>{topic.notes}</p>
                            </div>
                            {topic.keyPoints && topic.keyPoints.length > 0 && (
                              <div className="roadmap-key-points">
                                <strong>Key concepts</strong>
                                <ul>{topic.keyPoints.map((point, pointIndex) => <li key={pointIndex}>{point}</li>)}</ul>
                              </div>
                            )}
                            {topic.practiceTask && (
                              <div className="roadmap-practice"><strong>Practice task</strong><p>{topic.practiceTask}</p></div>
                            )}
                          </section>
                        ))}
                      </div>
                    )}

                    <div className="roadmap-resources">
                      {skill.officialResource && skill.officialResource.url && (
                        <a href={skill.officialResource.url} target="_blank" rel="noreferrer">
                          <BookOpen size={14} /> {skill.officialResource.title || "Official documentation"} <ExternalLink size={12} />
                        </a>
                      )}
                      {skill.youtubeVideos && skill.youtubeVideos.length > 0 ? (
                        <div className="roadmap-video-list">
                          {skill.youtubeVideos.map((video) => (
                            <a className="roadmap-video-link" href={video.url} target="_blank" rel="noreferrer" key={video.url}>
                              {video.thumbnail ? <img src={video.thumbnail} alt="" /> : <PlayCircle size={24} />}
                              <span><strong>{video.title}</strong><small>{video.channel}</small></span>
                              <ExternalLink size={12} />
                            </a>
                          ))}
                        </div>
                      ) : skill.youtubeSearchUrl ? (
                        <a href={skill.youtubeSearchUrl} target="_blank" rel="noreferrer">
                          <Youtube size={15} /> Find tutorials on YouTube <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export default CareerRoadmap;
