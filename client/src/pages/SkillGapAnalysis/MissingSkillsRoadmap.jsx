import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock3, Code2, ExternalLink, GraduationCap, Layers3, ListChecks,
  LoaderCircle, RefreshCw, Sparkles, Target, Trophy, Workflow
} from "lucide-react";
import {
  generateMissingSkillsRoadmap, getMissingSkillsRoadmap, updateMissingSkillStatus,
  generateMissingSkillsWeeklyPlan, updateMissingSkillsWeeklyTask,
  generateMissingSkillProject, updateMissingSkillProjectStatus,
  generateMissingSkillAssessment, submitMissingSkillAssessment
} from "../../services/skillGapService";
import "./MissingSkillsRoadmap.css";

const VIEWS = [
  { id: "overview", label: "Roadmap", icon: Target },
  { id: "planner", label: "Weekly planner", icon: ListChecks },
  { id: "projects", label: "Hands-on projects", icon: Code2 },
  { id: "verify", label: "Skill verification", icon: Trophy }
];

function MissingSkillsRoadmap({ profile, missingSkills = [], jobIds = [] }) {
  const [roadmap, setRoadmap] = useState([]);
  const [savedRole, setSavedRole] = useState("");
  const [weeklyPlan, setWeeklyPlan] = useState([]);
  const [activeView, setActiveView] = useState("overview");
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [generating, setGenerating] = useState("");
  const [updating, setUpdating] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeQuizSkill, setActiveQuizSkill] = useState("");
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [submittingQuiz, setSubmittingQuiz] = useState(false);

  const targetRole = profile?.targetRole || "";
  const completedCount = roadmap.filter((item) => item.status === "Completed").length;
  const inProgressCount = roadmap.filter((item) => item.status === "In Progress").length;
  const progress = roadmap.length ? Math.round(completedCount / roadmap.length * 100) : 0;
  const hasCurrentGaps = missingSkills.length > 0 && jobIds.length > 0;
  const currentGapNames = missingSkills.map((item) => (typeof item === "string" ? item : item.name).toLowerCase()).sort();
  const savedGapNames = roadmap.map((item) => item.skill.toLowerCase()).sort();
  const sameSkillSet = currentGapNames.length === savedGapNames.length && currentGapNames.every((name, index) => name === savedGapNames[index]);
  const roadmapIsCurrent = savedRole && savedRole.toLowerCase() === targetRole.toLowerCase() && sameSkillSet;
  const sortedRoadmap = useMemo(() => [...roadmap].sort((a, b) => (a.order || 0) - (b.order || 0)), [roadmap]);
  const activeQuizItem = roadmap.find((item) => item._id === activeQuizSkill);
  const activeAssessment = activeQuizItem?.assessment;

  useEffect(() => {
    let active = true;
    const loadSaved = async () => {
      try {
        setLoadingSaved(true);
        const result = await getMissingSkillsRoadmap();
        if (!active) return;
        setRoadmap(result.roadmap || []);
        setSavedRole(result.targetRole || "");
        setWeeklyPlan(result.weeklyPlan || []);
      } catch (err) {
        if (active) setError(err?.response?.data?.message || "Unable to load your saved learning workspace.");
      } finally {
        if (active) setLoadingSaved(false);
      }
    };
    loadSaved();
    return () => { active = false; };
  }, []);

  const handleGenerateRoadmap = async () => {
    if (!hasCurrentGaps || !targetRole) return;
    try {
      setGenerating("roadmap"); setError(""); setNotice("");
      const result = await generateMissingSkillsRoadmap({ jobIds, missingSkills });
      setRoadmap(result.roadmap || []); setSavedRole(result.targetRole || targetRole);
      setWeeklyPlan([]);
      setNotice("Your roadmap has been refreshed. Generate a new weekly plan to match these skills.");
    } catch (err) {
      setError(err?.response?.data?.message || "We could not generate your roadmap. Please try again.");
    } finally { setGenerating(""); }
  };

  const handleStatusChange = async (itemId, status) => {
    const previous = roadmap;
    setRoadmap((items) => items.map((item) => item._id === itemId ? { ...item, status } : item));
    setUpdating(itemId); setError("");
    try {
      await updateMissingSkillStatus(itemId, status);
    } catch (err) {
      setRoadmap(previous);
      setError(err?.response?.data?.message || "Could not save your learning progress.");
    } finally { setUpdating(""); }
  };

  const handleGenerateWeeklyPlan = async () => {
    try {
      setGenerating("planner"); setError(""); setNotice("");
      const result = await generateMissingSkillsWeeklyPlan();
      setWeeklyPlan(result.weeks || []);
      setNotice("Your weekly learning plan was generated and saved.");
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to generate the weekly plan.");
    } finally { setGenerating(""); }
  };

  const handleTaskToggle = async (weekIndex, taskIndex, completed) => {
    const previous = weeklyPlan;
    setWeeklyPlan((weeks) => weeks.map((week, wi) => wi !== weekIndex ? week : {
      ...week, tasks: week.tasks.map((task, ti) => ti === taskIndex ? { ...task, completed } : task)
    }));
    setUpdating("task-" + weekIndex + "-" + taskIndex);
    try {
      const result = await updateMissingSkillsWeeklyTask(weekIndex, taskIndex, completed);
      setWeeklyPlan(result.weeks || previous);
    } catch (err) {
      setWeeklyPlan(previous);
      setError(err?.response?.data?.message || "Unable to save this task.");
    } finally { setUpdating(""); }
  };

  const handleGenerateProject = async (itemId) => {
    try {
      setGenerating("project-" + itemId); setError("");
      const result = await generateMissingSkillProject(itemId);
      setRoadmap((items) => items.map((item) => item._id === itemId ? { ...item, project: result.project } : item));
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to generate this project.");
    } finally { setGenerating(""); }
  };

  const handleProjectStatus = async (itemId, status) => {
    const item = roadmap.find((entry) => entry._id === itemId);
    const previous = item?.project;
    setRoadmap((items) => items.map((entry) => entry._id === itemId ? { ...entry, project: { ...entry.project, status } } : entry));
    setUpdating("project-" + itemId);
    try {
      const result = await updateMissingSkillProjectStatus(itemId, status);
      setRoadmap((items) => items.map((entry) => entry._id === itemId ? { ...entry, project: result.project } : entry));
    } catch (err) {
      setRoadmap((items) => items.map((entry) => entry._id === itemId ? { ...entry, project: previous } : entry));
      setError(err?.response?.data?.message || "Unable to save project status.");
    } finally { setUpdating(""); }
  };

  const handleGenerateAssessment = async (itemId) => {
    try {
      setGenerating("quiz-" + itemId); setError(""); setQuizResult(null); setQuizAnswers({});
      const result = await generateMissingSkillAssessment(itemId);
      setRoadmap((items) => items.map((item) => item._id === itemId ? { ...item, assessment: result.assessment } : item));
      setActiveQuizSkill(itemId);
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to generate the skill assessment.");
    } finally { setGenerating(""); }
  };

  const handleSubmitQuiz = async () => {
    if (!activeQuizItem || !activeAssessment?.questions?.length) return;
    if (Object.keys(quizAnswers).length !== activeAssessment.questions.length) {
      setError("Please answer all questions before submitting."); return;
    }
    try {
      setSubmittingQuiz(true); setError("");
      const answers = activeAssessment.questions.map((_, index) => Number(quizAnswers[index]));
      const result = await submitMissingSkillAssessment(activeQuizItem._id, answers);
      setQuizResult(result);
      setRoadmap((items) => items.map((item) => item._id === activeQuizItem._id ? {
        ...item, assessment: { ...item.assessment, verified: result.verified, attempts: [...(item.assessment?.attempts || []), { score: result.score, total: result.total, percentage: result.percentage, passed: result.passed }] }
      } : item));
    } catch (err) {
      setError(err?.response?.data?.message || "Unable to submit your assessment.");
    } finally { setSubmittingQuiz(false); }
  };

  const prerequisites = sortedRoadmap.filter((item) => item.prerequisites?.length);
  const plannerTaskCount = weeklyPlan.reduce((total, week) => total + (week.tasks || []).length, 0);
  const plannerDoneCount = weeklyPlan.reduce((total, week) => total + (week.tasks || []).filter((task) => task.completed).length, 0);

  if (loadingSaved) return <div className="learning-loading"><LoaderCircle className="learning-spin" size={22} /> Loading your learning workspace...</div>;

  if (!hasCurrentGaps) return (
    <section className="learning-workspace">
      <div className="learning-empty">
        <span className="learning-empty-icon"><GraduationCap size={30} /></span>
        <h2>{missingSkills.length ? "Refresh your job analysis" : "Your learning workspace is waiting"}</h2>
        <p>{missingSkills.length ? "Refresh Skill Gap Analysis so JobPulse can use the latest job listings." : "Once Skill Gap Analysis identifies missing skills for your target role, generate a personalised learning roadmap here."}</p>
      </div>
    </section>
  );

  return (
    <section className="learning-workspace">
      <header className="learning-hero">
        <div className="learning-hero-copy">
          <span className="learning-eyebrow"><Sparkles size={14} /> YOUR AI LEARNING STUDIO</span>
          <h2>Turn skill gaps into real skills.</h2>
          <p>A guided space to learn, build projects and check your understanding for <strong>{targetRole || "your target role"}</strong>.</p>
        </div>
        <div className="learning-hero-art"><div className="learning-orbit orbit-one" /><div className="learning-orbit orbit-two" /><span><GraduationCap size={34} /></span></div>
      </header>

      <div className="learning-summary">
        <div><span>Skills to develop</span><strong>{missingSkills.length}</strong><small>From analysed job listings</small></div>
        <div><span>Learning progress</span><strong>{progress}%</strong><small>{completedCount} of {roadmap.length} learning steps completed</small></div>
        <div><span>Study plan</span><strong>{weeklyPlan.length || "—"}</strong><small>{weeklyPlan.length ? "Weeks planned" : "Not generated yet"}</small></div>
      </div>

      <nav className="learning-nav" aria-label="Learning workspace">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={activeView === id ? "active" : ""} onClick={() => { setActiveView(id); setQuizResult(null); }}>
            <Icon size={16} /><span>{label}</span>{id === "verify" && roadmap.some((item) => item.assessment?.verified) && <i className="learning-nav-indicator" />}
          </button>
        ))}
      </nav>

      {error && <div className="learning-alert" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></div>}
      {notice && <div className="learning-notice"><CheckCircle2 size={16} />{notice}</div>}

      {!roadmapIsCurrent && roadmap.length > 0 && (
        <div className="learning-stale"><strong>Your skill gaps have changed.</strong> Your saved roadmap is based on an earlier role or skill list. Regenerate it to update your learning workspace.</div>
      )}

      {activeView === "overview" && (
        <div className="learning-view">
          <div className="learning-section-heading">
            <div><span className="learning-kicker">YOUR PERSONAL PATH</span><h3>Learning roadmap</h3><p>Skills are ordered using job demand and prerequisite relationships.</p></div>
            <button className="learning-primary-button" onClick={handleGenerateRoadmap} disabled={!targetRole || generating === "roadmap"}>
              {generating === "roadmap" ? <LoaderCircle className="learning-spin" size={16} /> : <RefreshCw size={16} />}
              {roadmap.length ? "Regenerate roadmap" : "Generate roadmap"}
            </button>
          </div>
          {!roadmap.length ? (
            <div className="learning-empty compact"><Target size={26}/><strong>Build your personalised roadmap</strong><p>Gemini will create a learning sequence from your current missing skills and job evidence.</p><button className="learning-primary-button" onClick={handleGenerateRoadmap} disabled={generating === "roadmap"}>Generate my roadmap <ArrowRight size={15}/></button></div>
          ) : (
            <>
              <div className="learning-progress-card">
                <div><span>Learning journey</span><strong>{progress}%</strong></div>
                <div className="learning-progress-track"><span style={{ width: progress + "%" }} /></div>
                <small>{completedCount} completed · {inProgressCount} in progress · {roadmap.length - completedCount - inProgressCount} to start</small>
              </div>
              {prerequisites.length > 0 && <div className="learning-dependency-card"><div className="learning-dependency-icon"><Workflow size={19}/></div><div><strong>Recommended learning order</strong><p>{prerequisites.map((item) => item.skill + " after " + item.prerequisites.join(", ")).join(" · ")}</p><small>Prerequisites are generated by Gemini and limited to the missing skills in this roadmap.</small></div></div>}
              <div className="learning-skill-list">
                {sortedRoadmap.map((item, index) => (
                  <article className="learning-skill-card" key={item._id || item.skill}>
                    <div className="learning-skill-number">{String(index + 1).padStart(2, "0")}</div>
                    <div className="learning-skill-content">
                      <div className="learning-skill-top"><div><span className="learning-kicker">{item.priority} PRIORITY · {item.estimatedWeeks} {item.estimatedWeeks === 1 ? "WEEK" : "WEEKS"}</span><h4>{item.skill}</h4></div><span className={"learning-status-pill " + (item.status === "Completed" ? "done" : item.status === "In Progress" ? "active" : "")}>{item.status || "Not Started"}</span></div>
                      <p>{item.reason}</p>
                      <div className="learning-skill-meta"><span><BookOpen size={13}/>{(item.topics || []).length} learning topics</span><span><Target size={13}/>{item.jobCount} job listings mention this</span></div>
                      {item.prerequisites?.length > 0 && <div className="learning-prereq"><Layers3 size={14}/> Learn first: {item.prerequisites.join(", ")}</div>}
                      <details className="learning-topics"><summary>View topics and learning resources <ChevronDown size={14}/></summary><ul>{(item.topics || []).map((topic) => <li key={topic}>{topic}</li>)}</ul><div className="learning-resource-links">{(item.resources || []).map((resource) => <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">{resource.title} <ExternalLink size={12}/></a>)}</div></details>
                      <div className="learning-card-footer"><label htmlFor={"learning-status-" + item._id}>Learning status</label><select id={"learning-status-" + item._id} value={item.status || "Not Started"} disabled={updating === item._id} onChange={(event) => handleStatusChange(item._id, event.target.value)}><option>Not Started</option><option>In Progress</option><option>Completed</option></select></div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeView === "planner" && (
        <div className="learning-view">
          <div className="learning-section-heading"><div><span className="learning-kicker">STUDY WITH A PLAN</span><h3>Weekly learning planner</h3><p>Gemini breaks your roadmap into manageable weekly goals and actionable tasks.</p></div><button className="learning-primary-button" onClick={handleGenerateWeeklyPlan} disabled={!roadmap.length || generating === "planner"}>{generating === "planner" ? <LoaderCircle className="learning-spin" size={16}/> : <Sparkles size={16}/>} {weeklyPlan.length ? "Regenerate plan" : "Create weekly plan"}</button></div>
          {!roadmap.length ? <div className="learning-empty compact"><Target size={25}/><strong>Generate your roadmap first</strong><p>Your weekly plan will be based on the skills and dependencies in that roadmap.</p><button className="learning-text-button" onClick={() => setActiveView("overview")}>Go to roadmap <ArrowRight size={14}/></button></div> : !weeklyPlan.length ? <div className="learning-empty compact"><ListChecks size={27}/><strong>Your week-by-week plan is ready to build</strong><p>Gemini will arrange your missing skills into a practical study schedule.</p><button className="learning-primary-button" onClick={handleGenerateWeeklyPlan} disabled={generating === "planner"}>Generate weekly plan <ArrowRight size={15}/></button></div> : <>
            <div className="learning-plan-progress"><div><strong>{plannerDoneCount} / {plannerTaskCount}</strong><span>tasks completed</span></div><div className="learning-progress-track"><span style={{width: (plannerTaskCount ? plannerDoneCount / plannerTaskCount * 100 : 0) + "%"}}/></div><small>{Math.round(plannerDoneCount / Math.max(1, plannerTaskCount) * 100)}% of your weekly plan completed</small></div>
            {sortedRoadmap.some((item) => item.prerequisites?.length) && <div className="learning-dependency-card"><div className="learning-dependency-icon"><Workflow size={19}/></div><div><strong>Follow the prerequisite sequence</strong><p>{sortedRoadmap.filter((item) => item.prerequisites?.length).map((item) => item.prerequisites.join(", ") + " → " + item.skill).join(" · ")}</p></div></div>}
            <div className="learning-week-list">{weeklyPlan.map((week, weekIndex) => <article className="learning-week-card" key={week.weekNumber}><div className="learning-week-heading"><div className="learning-week-badge">WEEK {week.weekNumber}</div><div><h4>{week.title}</h4><p>{(week.focusSkills || []).join(" · ")}</p></div><span>{week.tasks.filter((task) => task.completed).length}/{week.tasks.length}</span></div><div className="learning-week-tasks">{week.tasks.map((task, taskIndex) => <label className={"learning-task " + (task.completed ? "checked" : "")} key={taskIndex}><input type="checkbox" checked={Boolean(task.completed)} disabled={updating === "task-" + weekIndex + "-" + taskIndex} onChange={(event) => handleTaskToggle(weekIndex, taskIndex, event.target.checked)}/><span className="learning-task-check"><Check size={13}/></span><span><strong>{task.title}</strong><small>{task.description}</small><em>{task.skill}</em></span></label>)}</div></article>)}</div>
          </>}
        </div>
      )}

      {activeView === "projects" && (
        <div className="learning-view">
          <div className="learning-section-heading"><div><span className="learning-kicker">LEARN BY BUILDING</span><h3>Hands-on projects</h3><p>Generate a focused portfolio mini-project for each missing skill. Project briefs are created by Gemini and saved to your account.</p></div></div>
          {!roadmap.length ? <div className="learning-empty compact"><strong>No roadmap skills yet</strong><p>Generate your roadmap before creating skill projects.</p></div> : <div className="learning-project-grid">{sortedRoadmap.map((item) => <article className="learning-project-card" key={item._id}><div className="learning-project-card-top"><span className="learning-project-icon"><Code2 size={19}/></span><span className={"learning-status-pill " + (item.project?.status === "Completed" ? "done" : item.project?.status === "In Progress" ? "active" : "")}>{item.project?.status || "Not created"}</span></div><span className="learning-kicker">PROJECT FOR</span><h4>{item.skill}</h4>{item.project ? <><h5>{item.project.title}</h5><p>{item.project.overview}</p><div className="learning-project-meta"><span>{item.project.difficulty}</span><span><Clock3 size={13}/>{item.project.estimatedHours} hours</span></div><details><summary>View project brief <ChevronDown size={14}/></summary>{item.project.scenario && <p>{item.project.scenario}</p>}<strong>What to build</strong><ul>{(item.project.requirements || []).map((entry, i) => <li key={i}>{entry}</li>)}</ul><strong>Deliverables</strong><ul>{(item.project.deliverables || []).map((entry, i) => <li key={i}>{entry}</li>)}</ul>{item.project.extensionIdeas?.length > 0 && <><strong>Optional extensions</strong><ul>{item.project.extensionIdeas.map((entry, i) => <li key={i}>{entry}</li>)}</ul></>}</details><div className="learning-project-footer"><label>Status</label><select value={item.project.status || "Not Started"} disabled={updating === "project-" + item._id} onChange={(event) => handleProjectStatus(item._id, event.target.value)}><option>Not Started</option><option>In Progress</option><option>Completed</option></select></div><button className="learning-secondary-button" onClick={() => handleGenerateProject(item._id)} disabled={generating === "project-" + item._id}>{generating === "project-" + item._id ? <LoaderCircle className="learning-spin" size={15}/> : <RefreshCw size={15}/>} Regenerate project</button></> : <><p>Get a practical project brief designed around the topics in your learning roadmap.</p><button className="learning-primary-button full" onClick={() => handleGenerateProject(item._id)} disabled={generating === "project-" + item._id}>{generating === "project-" + item._id ? <LoaderCircle className="learning-spin" size={15}/> : <Sparkles size={15}/>} Generate project</button></>}</article>)}</div>}
        </div>
      )}

      {activeView === "verify" && (
        <div className="learning-view">
          <div className="learning-section-heading"><div><span className="learning-kicker">CHECK YOUR UNDERSTANDING</span><h3>Skill verification</h3><p>Take a short Gemini-generated assessment. A passing score verifies your understanding; it does not automatically change your profile skills.</p></div></div>
          {!roadmap.length ? <div className="learning-empty compact"><strong>No roadmap skills yet</strong><p>Generate your roadmap to create skill assessments.</p></div> : <div className="learning-verification-layout">
            <div className="learning-verification-list">{sortedRoadmap.map((item) => <button type="button" key={item._id} className={"learning-verification-item " + (activeQuizSkill === item._id ? "selected" : "")} onClick={() => {setActiveQuizSkill(item._id);setQuizResult(null);setQuizAnswers({});}}><span className="learning-verification-icon">{item.assessment?.verified ? <CheckCircle2 size={18}/> : <GraduationCap size={18}/>}</span><span><strong>{item.skill}</strong><small>{item.assessment?.verified ? "Verified" : item.assessment ? "Assessment ready" : "Not assessed yet"}</small></span><ChevronRight size={16}/></button>)}</div>
            <div className="learning-quiz-panel">
              {!activeQuizItem ? <div className="learning-quiz-empty"><Trophy size={28}/><strong>Select a skill to verify</strong><p>Choose a skill to generate or continue its assessment.</p></div> : !activeAssessment?.questions?.length ? <div className="learning-quiz-empty"><span className="learning-quiz-symbol"><GraduationCap size={27}/></span><span className="learning-kicker">SKILL CHECK</span><h4>{activeQuizItem.skill}</h4><p>Gemini will create 8 multiple-choice questions based on the learning topics in your roadmap. You need 70% to pass.</p><button className="learning-primary-button" onClick={() => handleGenerateAssessment(activeQuizItem._id)} disabled={generating === "quiz-" + activeQuizItem._id}>{generating === "quiz-" + activeQuizItem._id ? <LoaderCircle className="learning-spin" size={15}/> : <Sparkles size={15}/>} Generate assessment</button></div> : quizResult ? <div className="learning-result-panel"><span className={"learning-result-icon " + (quizResult.passed ? "passed" : "retry")}>{quizResult.passed ? <Trophy size={27}/> : <RefreshCw size={25}/>}</span><span className="learning-kicker">ASSESSMENT RESULT</span><h4>{quizResult.percentage}%</h4><strong>{quizResult.passed ? "Skill verified!" : "Keep practising and try again"}</strong><p>You answered {quizResult.score} out of {quizResult.total} questions correctly. Passing score: 70%.</p><div className="learning-answer-review">{quizResult.results.map((result, index) => <div className={result.isCorrect ? "correct" : "incorrect"} key={index}><strong>{index + 1}. {result.isCorrect ? "Correct" : "Review this answer"}</strong><p>{result.explanation}</p></div>)}</div><button className="learning-primary-button" onClick={() => {setQuizResult(null);setQuizAnswers({});}}>Retake assessment</button></div> : <><div className="learning-quiz-heading"><div><span className="learning-kicker">SKILL ASSESSMENT</span><h4>{activeAssessment.title}</h4></div><span>{activeAssessment.questions.length} questions</span></div><div className="learning-quiz-progress"><span style={{width: (Object.keys(quizAnswers).length / activeAssessment.questions.length * 100) + "%"}}/></div><div className="learning-questions">{activeAssessment.questions.map((question, index) => <fieldset className="learning-question" key={index}><legend><span>QUESTION {index + 1}</span>{question.question}</legend><div className="learning-options">{question.options.map((option, optionIndex) => <label className={Number(quizAnswers[index]) === optionIndex ? "chosen" : ""} key={optionIndex}><input type="radio" name={"question-" + index} checked={Number(quizAnswers[index]) === optionIndex} onChange={() => setQuizAnswers((answers) => ({...answers, [index]: optionIndex}))}/><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</label>)}</div></fieldset>)}</div><div className="learning-submit-row"><span>{Object.keys(quizAnswers).length} of {activeAssessment.questions.length} answered</span><button className="learning-primary-button" onClick={handleSubmitQuiz} disabled={submittingQuiz || Object.keys(quizAnswers).length !== activeAssessment.questions.length}>{submittingQuiz ? <LoaderCircle className="learning-spin" size={15}/> : <CheckCircle2 size={15}/>} Submit answers</button></div></>}
            </div>
          </div>}
        </div>
      )}
    </section>
  );
}

export default MissingSkillsRoadmap;
