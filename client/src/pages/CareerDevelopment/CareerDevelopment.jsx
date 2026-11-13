import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, BriefcaseBusiness, CheckCircle2,
  Compass, GraduationCap, LoaderCircle, Map, RefreshCw, Route, Save,
  Target, TrendingUp
} from "lucide-react";
import Navbar from "../../components/Navbar/Navbar";
import {
  createGeminiLearningRoadmap, generateGeminiCareerRecommendations, getCareerDevelopment, getGeminiInterestOptions, saveCareerPreferences, updateLearningStatus
} from "../../services/careerDevelopmentService";
import "./CareerDevelopment.css";

const STATUS = ["Not Started", "In Progress", "Completed"];

function CareerDevelopment() {
  const [data, setData] = useState(null);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [interestOptions, setInterestOptions] = useState([]);
  const [generatingRoles, setGeneratingRoles] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const [rolesPage, setRolesPage] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [result, interestResult] = await Promise.all([getCareerDevelopment(), getGeminiInterestOptions()]);
      setData(result);
      setInterestOptions(interestResult.interests || []);
      setSelectedInterests(result.interests || []);
      setSelectedRole(result.selectedRole || "");
      setRolesPage(0);
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to load Career Navigator. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const roles = data?.roles || [];
  const profileSkills = data?.profile?.currentSkills || [];
  const roadmap = data?.roadmap || [];
  const completed = roadmap.filter((item) => item.status === "Completed").length;
  const progress = roadmap.length ? Math.round(completed / roadmap.length * 100) : 0;
  const selectedRoleData = roles.find((role) => role.title === selectedRole);
  const recommendedRoles = useMemo(() => {
    if (!selectedInterests.length) return roles;
    const selected = new Set(selectedInterests.map((item) => item.trim().toLowerCase()));
    return roles.filter((role) => (role.interests || []).some((interest) => selected.has(interest.trim().toLowerCase())));
  }, [roles, selectedInterests]);
  const rolesPerPage = 6;
  const rolesPageCount = Math.ceil(recommendedRoles.length / rolesPerPage);
  const visibleRoles = recommendedRoles.slice(rolesPage * rolesPerPage, (rolesPage + 1) * rolesPerPage);

  const toggleInterest = (interest) => {
    setSelectedInterests((current) => current.includes(interest)
      ? current.filter((item) => item !== interest)
      : [...current, interest]);
  };

  const handleSavePreferences = async () => {
    try {
      setSaving(true); setError(""); setMessage("");
      const result = await saveCareerPreferences(selectedInterests, selectedRole);
      setGeneratingRoles(true);
      await generateGeminiCareerRecommendations(result.interests || selectedInterests);
      setGeneratingRoles(false);
      setSelectedInterests(result.interests || []);
      setSelectedRole("");
      setRolesPage(0);
      setMessage("Gemini generated career paths based on your selected interests and profile.");
      await load();
    } catch (err) {
      setGeneratingRoles(false);
      setError(err?.response?.data?.message || "Could not save preferences or generate Gemini career recommendations.");
    } finally { setSaving(false); }
  };

  const handleGenerate = async (roleName = selectedRole) => {
    if (!roleName) { setError("Select a career role before generating a roadmap."); return; }
    try {
      setGenerating(true); setError(""); setMessage("");
      const result = await createGeminiLearningRoadmap(roleName);
      setData((current) => ({ ...current, roadmap: result.roadmap, selectedRole: result.selectedRole }));
      setSelectedRole(result.selectedRole);
      setMessage("Your learning roadmap has been created and saved to your account.");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not create the learning roadmap.");
    } finally { setGenerating(false); }
  };

  const handleStatus = async (itemId, status) => {
    try {
      setUpdatingId(itemId); setError("");
      const result = await updateLearningStatus(itemId, status);
      setData((current) => ({ ...current, roadmap: result.roadmap }));
    } catch (err) {
      setError(err?.response?.data?.message || "Could not update learning progress.");
    } finally { setUpdatingId(""); }
  };

  if (loading) return <><Navbar dashboardMode /><main className="career-dev-page"><div className="career-dev-loading"><LoaderCircle className="career-dev-spin" /> Loading your career workspace and Gemini interest options...</div></main></>;

  return (
    <>
      <Navbar dashboardMode />
      <main className="career-dev-page">
        <section className="career-dev-hero">
          <div>
            <span className="career-dev-eyebrow"><Compass size={15} /> CAREER TRAJECTORY INTELLIGENCE</span>
            <h1>Career Navigator</h1>
            <p>Explore career directions based on your current skills and interests, then turn skill gaps into a trackable learning plan.</p>
          </div>
          <button className="career-dev-refresh" onClick={load} disabled={loading}><RefreshCw size={16} /> Refresh analysis</button>
        </section>

        {error && <div className="career-dev-alert" role="alert">{error}</div>}
        {message && <div className="career-dev-success" role="status"><CheckCircle2 size={17} />{message}</div>}

        <section className="career-dev-profile-strip career-dev-profile-strip-two">
          <div><span>YOUR CURRENT SKILLS</span><strong>{profileSkills.length}</strong><small>{data?.profile?.targetRole || "No target role saved in profile"}</small></div>
          <div><span>LEARNING PROGRESS</span><strong>{progress}%</strong><small>{completed} of {roadmap.length} roadmap skills completed</small></div>
        </section>

        <section className="career-dev-panel">
          <div className="career-dev-section-title"><div><span>STEP 1</span><h2>Choose your career interests</h2><p>Select areas that genuinely interest you. Recommendations consider both your skills and your interests.</p></div><Target /></div>
          <div className="career-dev-interest-grid">
            {interestOptions.map((interest) => (
              <label className={selectedInterests.includes(interest) ? "career-interest active" : "career-interest"} key={interest}>
                <input type="checkbox" checked={selectedInterests.includes(interest)} onChange={() => toggleInterest(interest)} />
                <span>{interest}</span>
              </label>
            ))}
          </div>
          <div className="career-dev-panel-actions">
            <small>Choose up to 12 interests. Gemini generates relevant career paths after you save. You can change them anytime.</small>
            <button onClick={handleSavePreferences} disabled={saving || selectedInterests.length > 12}>
              {saving || generatingRoles ? <LoaderCircle className="career-dev-spin" size={16} /> : <Save size={16} />} {generatingRoles ? "Generating career paths with Gemini..." : saving ? "Saving..." : "Save interests & generate paths"}
            </button>
          </div>
        </section>

        <section className="career-dev-panel">
          <div className="career-dev-section-title"><div><span>STEP 2</span><h2>Career paths recommended for you</h2><p>{selectedInterests.length ? "Showing career paths connected to your selected interests, ranked by skill fit and job-demand signals." : "Choose and save interests above to see career paths relevant to what you want to explore."}</p></div><BriefcaseBusiness /></div>
          {selectedInterests.length > 0 && recommendedRoles.length === 0 && <div className="career-dev-info">No catalogue roles are directly mapped to these interests yet. Try selecting a related interest to explore more paths.</div>}
          {!profileSkills.length && <div className="career-dev-info">Your profile has no saved skills yet. Add or extract skills in My Profile to make skill-fit recommendations more useful. You can still explore roles using your interests.</div>}
          <div className="career-dev-role-grid">
            {visibleRoles.map((role) => (
              <article className={selectedRole === role.title ? "career-role-card selected" : "career-role-card"} key={role.title}>
                <div className="career-role-top"><span>{role.industry}</span><strong>{role.recommendationScore}% match</strong></div>
                <h3>{role.title}</h3>
                <p>{role.interests.join(" · ")}</p>
                <div className="career-role-metrics">
                  <span><CheckCircle2 size={14} /> {role.matchedSkills.length} matched</span>
                  <span><Target size={14} /> {role.missingSkills.length} to develop</span>
                </div>
                <div className="career-role-demand"><TrendingUp size={14} /> Found in {role.demandCount} sampled listings</div>
                <div className="career-dev-score-breakdown">
                  <span>Skills <b>{role.skillFit}%</b></span>
                  <span>Interests <b>{role.interestFit}%</b></span>
                  <span>Demand <b>{role.demandFit}%</b></span>
                </div>
                <div className="career-role-skills"><strong>Skills to develop</strong><div>{role.missingSkills.slice(0, 5).map((skill) => <span key={skill}>{skill}</span>)}</div></div>
                <button className="career-role-select" onClick={() => { setSelectedRole(role.title); setMessage(""); }}>
                  {selectedRole === role.title ? "Selected career path" : "Explore this career"} <ArrowRight size={15} />
                </button>
              </article>
            ))}
          </div>
          {rolesPageCount > 1 && (
            <div className="career-dev-pagination" aria-label="Career path pages">
              <button type="button" onClick={() => setRolesPage((page) => Math.max(0, page - 1))} disabled={rolesPage === 0} aria-label="Previous career paths">
                <ArrowLeft size={16} /> Previous
              </button>
              <span>Showing {rolesPage * rolesPerPage + 1}–{Math.min((rolesPage + 1) * rolesPerPage, recommendedRoles.length)} of {recommendedRoles.length} career paths <b>·</b> Page {rolesPage + 1} of {rolesPageCount}</span>
              <button type="button" onClick={() => setRolesPage((page) => Math.min(rolesPageCount - 1, page + 1))} disabled={rolesPage >= rolesPageCount - 1} aria-label="Next career paths">
                Next <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div className="career-dev-panel-actions">
            <label className="career-dev-select-label">Selected career role
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>
                <option value="">Choose a role</option>
                {roles.map((role) => <option value={role.title} key={role.title}>{role.title}</option>)}
              </select>
            </label>
            <button onClick={handleSavePreferences} disabled={saving || !selectedRole}><Save size={16} /> Save selected role</button>
          </div>
        </section>

        {selectedRoleData && (
          <section className="career-dev-panel career-dev-role-detail">
            <div className="career-dev-section-title"><div><span>ROLE DETAILS</span><h2>{selectedRoleData.title}</h2><p>{selectedRoleData.industry} · Typical next steps: {selectedRoleData.nextRoles.join(" → ")}</p></div><Route /></div>
            <div className="career-dev-detail-columns">
              <div><h3>Skills you already have</h3><div className="career-dev-skill-chips">{selectedRoleData.matchedSkills.length ? selectedRoleData.matchedSkills.map((skill) => <span className="matched" key={skill}>{skill}</span>) : <small>No direct matches in your saved profile yet.</small>}</div></div>
              <div><h3>Skills to develop</h3><div className="career-dev-skill-chips">{selectedRoleData.missingSkills.map((skill) => <span className="missing" key={skill}>{skill}</span>)}</div></div>
            </div>
            <div className="career-dev-guidance"><GraduationCap size={18} /><p>Start with the missing skills, build a practical project to demonstrate them, then update your profile and reassess your fit. This is guidance, not a hiring prediction.</p></div>
            <button className="career-dev-primary" onClick={() => handleGenerate(selectedRole)} disabled={generating || !selectedRoleData.missingSkills.length}>
              {generating ? <LoaderCircle className="career-dev-spin" size={17} /> : <Map size={17} />} {generating ? "Building roadmap..." : "Generate learning roadmap"}
            </button>
          </section>
        )}

        <section className="career-dev-panel">
          <div className="career-dev-section-title"><div><span>STEP 3</span><h2>Your learning roadmap</h2><p>Gemini creates a personalised sequence of topics, learning resources and practical exercises. Progress is saved to your account.</p></div><BookOpen /></div>
          {roadmap.length ? (
            <>
              <div className="career-dev-progress"><div><strong>{progress}% completed</strong><span>{completed} / {roadmap.length} skills</span></div><div className="career-dev-progress-track"><span style={{ width: progress + "%" }} /></div></div>
              <div className="career-roadmap-list">
                {roadmap.slice().sort((a,b) => a.order - b.order).map((item, index) => (
                  <article className="career-roadmap-item" key={item._id}>
                    <div className="career-roadmap-number">{index + 1}</div>
                    <div className="career-roadmap-content">
                      <div className="career-roadmap-item-head"><div><span className={"career-priority " + item.priority.toLowerCase()}>{item.priority} priority</span><h3>{item.skill}</h3><p>{item.reason}</p></div>
                        <label>Status<select value={item.status} disabled={updatingId === item._id} onChange={(event) => handleStatus(item._id, event.target.value)}>{STATUS.map((status) => <option key={status}>{status}</option>)}</select></label>
                      </div>
                      <div className="career-roadmap-meta"><span><BookOpen size={14} /> {item.topics.length} learning stages</span><span>{item.estimatedWeeks} estimated weeks</span></div>
                      <ol>{item.topics.map((topic, topicIndex) => <li key={topicIndex}>{topic}</li>)}</ol>
                      <div className="career-roadmap-task"><strong>Practice task</strong><p>{item.practiceTask}</p></div>
                      {item.resource?.url && <a href={item.resource.url} target="_blank" rel="noreferrer">{item.resource.title} <ArrowRight size={13} /></a>}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : <div className="career-dev-empty"><BookOpen size={28} /><strong>No learning roadmap yet</strong><p>Choose a career role above and generate a learning plan based on the skills you still need to develop.</p></div>}
        </section>

        <p className="career-dev-disclaimer">Career paths and learning roadmaps are generated by Gemini using your profile and selected interests. Skill match and job-demand signals are calculated from your profile and stored JobPulse listings; they are not predictions of hiring success.</p>
      </main>
    </>
  );
}

export default CareerDevelopment;
