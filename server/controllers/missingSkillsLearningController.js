const mongoose = require("mongoose");
const CareerDevelopment = require("../models/CareerDevelopment");
const { askGemini } = require("./geminiCareerController");

const clean = (value) => String(value == null ? "" : value).trim();
const norm = (value) => clean(value).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const userIdOf = (req) => req.user && (req.user._id || req.user.id || req.user.userId);
const safeQuestions = (assessment) => ({
  title: assessment?.title || "Skill check",
  passPercentage: assessment?.passPercentage || 70,
  questions: (assessment?.questions || []).map(({ question, options }, index) => ({ id: String(index), question, options }))
});
const getDoc = async (userId) => CareerDevelopment.findOne({ userId });

const generateWeeklyPlan = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in first." });
    const doc = await getDoc(userId);
    if (!doc?.missingSkillsRoadmap?.length) return res.status(400).json({ success: false, message: "Generate your Missing Skills Roadmap first." });
    const skills = doc.missingSkillsRoadmap.map((item) => ({
      skill: item.skill, topics: item.topics, prerequisites: item.prerequisites || [],
      estimatedWeeks: item.estimatedWeeks, priority: item.priority
    }));
    const data = await askGemini(
      "Create a realistic weekly learning planner using ONLY the supplied missing skills and topics. Return JSON only: { weeks: [{ weekNumber, title, focusSkills: string[], tasks: [{ title, description, skill }] }] }. Make a balanced sequence of 1 to 8 weeks based on estimated duration and prerequisites. Put prerequisites before dependent skills. Every supplied skill must appear in at least one task. Provide 3 to 5 actionable tasks per week, each task small enough for a learner studying 5-7 hours weekly. Do not add unrelated skills, invented resources, or job readiness claims. Role: " + doc.missingSkillsRoadmapRole + ". Skills and dependencies: " + JSON.stringify(skills),
      "missing skills weekly planner"
    );
    const weeks = (data.weeks || []).map((week, index) => ({
      weekNumber: Math.max(1, Number(week.weekNumber) || index + 1),
      title: clean(week.title) || "Learning week " + (index + 1),
      focusSkills: [...new Set((week.focusSkills || []).map(clean).filter((s) => skills.some((x) => norm(x.skill) === norm(s))))],
      tasks: (week.tasks || []).map((task) => ({
        title: clean(task.title), description: clean(task.description), skill: clean(task.skill),
        completed: false
      })).filter((task) => task.title && task.description && skills.some((s) => norm(s.skill) === norm(task.skill)))
    })).filter((week) => week.tasks.length);
    const covered = new Set(weeks.flatMap((week) => week.tasks.map((task) => norm(task.skill))));
    if (!weeks.length || skills.some((skill) => !covered.has(norm(skill.skill)))) {
      return res.status(502).json({ success: false, message: "Gemini returned an incomplete weekly plan. Please try generating it again." });
    }
    doc.missingSkillsWeeklyPlan = weeks;
    doc.missingSkillsWeeklyPlanRole = doc.missingSkillsRoadmapRole;
    doc.markModified("missingSkillsWeeklyPlan");
    await doc.save();
    console.log("Fresh Gemini weekly planner saved | user=" + String(userId) + " | weeks=" + weeks.length);
    return res.json({ success: true, weeks });
  } catch (error) {
    console.error("Generate missing skills weekly planner:", error.message);
    return res.status(error.status || 502).json({ success: false, message: error.message || "Unable to generate your weekly plan." });
  }
};

const updateWeeklyTask = async (req, res) => {
  try {
    const userId = userIdOf(req);
    const weekIndex = Number(req.params.weekIndex);
    const taskIndex = Number(req.params.taskIndex);
    const doc = await getDoc(userId);
    const weeks = doc?.missingSkillsWeeklyPlan || [];
    if (!doc || !Number.isInteger(weekIndex) || !Number.isInteger(taskIndex) || !weeks[weekIndex]?.tasks?.[taskIndex]) {
      return res.status(404).json({ success: false, message: "Learning task not found." });
    }
    weeks[weekIndex].tasks[taskIndex].completed = Boolean(req.body?.completed);
    doc.missingSkillsWeeklyPlan = weeks;
    doc.markModified("missingSkillsWeeklyPlan");
    await doc.save();
    return res.json({ success: true, weeks });
  } catch (error) {
    console.error("Update weekly learning task:", error);
    return res.status(500).json({ success: false, message: "Unable to save task progress." });
  }
};

const generateSkillProject = async (req, res) => {
  try {
    const userId = userIdOf(req);
    const itemId = req.params.itemId;
    if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ success: false, message: "Invalid roadmap skill." });
    const doc = await getDoc(userId);
    const item = doc?.missingSkillsRoadmap?.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: "Roadmap skill not found." });
    const data = await askGemini(
      "Design one original, achievable hands-on portfolio mini-project focused primarily on this one skill. Return JSON only: { title, difficulty, estimatedHours, overview, scenario, requirements: string[], deliverables: string[], extensionIdeas: string[] }. Requirements must be concrete implementation tasks and testable. Deliverables must describe what the learner should produce. Do not claim to create or execute code. Skill: " + item.skill + ". Topics to learn: " + JSON.stringify(item.topics) + ". Target role: " + doc.missingSkillsRoadmapRole + ". Learner context: beginner-to-intermediate IT student.",
      "hands-on project for " + item.skill
    );
    const project = {
      title: clean(data.title), difficulty: ["Beginner", "Intermediate", "Advanced"].includes(data.difficulty) ? data.difficulty : "Intermediate",
      estimatedHours: Math.max(2, Math.min(40, Number(data.estimatedHours) || 6)),
      overview: clean(data.overview), scenario: clean(data.scenario),
      requirements: (data.requirements || []).map(clean).filter(Boolean).slice(0, 10),
      deliverables: (data.deliverables || []).map(clean).filter(Boolean).slice(0, 6),
      extensionIdeas: (data.extensionIdeas || []).map(clean).filter(Boolean).slice(0, 5),
      status: item.project?.status || "Not Started",
      generatedAt: new Date()
    };
    if (!project.title || !project.overview || project.requirements.length < 3 || !project.deliverables.length) {
      return res.status(502).json({ success: false, message: "Gemini returned an incomplete project brief. Please try again." });
    }
    item.project = project;
    doc.markModified("missingSkillsRoadmap");
    await doc.save();
    console.log("Fresh Gemini project saved | user=" + String(userId) + " | skill=" + item.skill);
    return res.json({ success: true, project });
  } catch (error) {
    console.error("Generate skill project:", error.message);
    return res.status(error.status || 502).json({ success: false, message: error.message || "Unable to generate this project." });
  }
};

const updateSkillProjectStatus = async (req, res) => {
  try {
    const userId = userIdOf(req);
    const itemId = req.params.itemId;
    const status = clean(req.body?.status);
    if (!["Not Started", "In Progress", "Completed"].includes(status)) return res.status(400).json({ success: false, message: "Choose a valid project status." });
    const doc = await getDoc(userId);
    const item = doc?.missingSkillsRoadmap?.id(itemId);
    if (!item?.project) return res.status(404).json({ success: false, message: "Generate the project before updating its status." });
    item.project.status = status;
    doc.markModified("missingSkillsRoadmap");
    await doc.save();
    return res.json({ success: true, project: item.project });
  } catch (error) {
    console.error("Update skill project status:", error);
    return res.status(500).json({ success: false, message: "Unable to save project progress." });
  }
};

const generateSkillAssessment = async (req, res) => {
  try {
    const userId = userIdOf(req);
    const itemId = req.params.itemId;
    if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ success: false, message: "Invalid roadmap skill." });
    const doc = await getDoc(userId);
    const item = doc?.missingSkillsRoadmap?.id(itemId);
    if (!item) return res.status(404).json({ success: false, message: "Roadmap skill not found." });
    const data = await askGemini(
      "Create exactly 8 original multiple-choice assessment questions to test practical understanding of the named skill at beginner-to-intermediate level. Return JSON only: { title, questions: [{ question, options: string[4], correctAnswerIndex: number, explanation }] }. Exactly four options per question, one unambiguous correct answer, correctAnswerIndex 0-3. Avoid trivia, repeated questions and answers that are obvious from wording. Cover the supplied learning topics. Skill: " + item.skill + ". Topics: " + JSON.stringify(item.topics) + ". Target role: " + doc.missingSkillsRoadmapRole,
      "skill verification assessment for " + item.skill
    );
    const questions = (data.questions || []).map((q) => ({
      question: clean(q.question), options: (q.options || []).map(clean).slice(0, 4),
      correctAnswerIndex: Number(q.correctAnswerIndex), explanation: clean(q.explanation)
    })).filter((q) => q.question && q.options.length === 4 && Number.isInteger(q.correctAnswerIndex) && q.correctAnswerIndex >= 0 && q.correctAnswerIndex <= 3 && q.explanation);
    if (questions.length !== 8) return res.status(502).json({ success: false, message: "Gemini returned an incomplete assessment. Please generate it again." });
    item.assessment = { title: clean(data.title) || item.skill + " skill check", passPercentage: 70, questions, attempts: item.assessment?.attempts || [], verified: item.assessment?.verified || false, generatedAt: new Date() };
    doc.markModified("missingSkillsRoadmap");
    await doc.save();
    console.log("Fresh Gemini assessment saved | user=" + String(userId) + " | skill=" + item.skill);
    return res.json({ success: true, assessment: safeQuestions(item.assessment), verified: item.assessment.verified });
  } catch (error) {
    console.error("Generate skill assessment:", error.message);
    return res.status(error.status || 502).json({ success: false, message: error.message || "Unable to generate the assessment." });
  }
};

const submitSkillAssessment = async (req, res) => {
  try {
    const userId = userIdOf(req);
    const itemId = req.params.itemId;
    const doc = await getDoc(userId);
    const item = doc?.missingSkillsRoadmap?.id(itemId);
    const assessment = item?.assessment;
    if (!assessment?.questions?.length) return res.status(404).json({ success: false, message: "Generate the assessment before submitting answers." });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (answers.length !== assessment.questions.length || answers.some((answer) => !Number.isInteger(Number(answer)) || Number(answer) < 0 || Number(answer) > 3)) {
      return res.status(400).json({ success: false, message: "Please answer every question before submitting." });
    }
    const results = assessment.questions.map((question, index) => ({
      question: question.question, selectedAnswer: Number(answers[index]),
      correctAnswer: question.correctAnswerIndex, isCorrect: Number(answers[index]) === question.correctAnswerIndex,
      explanation: question.explanation
    }));
    const score = results.filter((result) => result.isCorrect).length;
    const percentage = Math.round(score / assessment.questions.length * 100);
    const passed = percentage >= (assessment.passPercentage || 70);
    assessment.attempts = assessment.attempts || [];
    assessment.attempts.push({ score, total: assessment.questions.length, percentage, passed, attemptedAt: new Date() });
    assessment.verified = Boolean(assessment.verified || passed);
    doc.markModified("missingSkillsRoadmap");
    await doc.save();
    return res.json({ success: true, score, total: assessment.questions.length, percentage, passed, verified: assessment.verified, results });
  } catch (error) {
    console.error("Submit skill assessment:", error);
    return res.status(500).json({ success: false, message: "Unable to evaluate your assessment." });
  }
};

module.exports = { generateWeeklyPlan, updateWeeklyTask, generateSkillProject, updateSkillProjectStatus, generateSkillAssessment, submitSkillAssessment };
