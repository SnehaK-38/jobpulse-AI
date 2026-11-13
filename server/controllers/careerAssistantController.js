const User = require("../models/User");
const Job = require("../models/Job");
const JobShortlist = require("../models/JobShortlist");
const CareerDevelopment = require("../models/CareerDevelopment");
const CareerAssistantConversation = require("../models/CareerAssistantConversation");
const { askGemini } = require("./geminiCareerController");

const clean = (value) => String(value == null ? "" : value).trim();
const userIdOf = (req) => req.user && (req.user._id || req.user.id || req.user.userId);
const publicMessages = (messages) => (messages || []).map((message) => ({
  id: String(message._id || ""),
  role: message.role,
  content: message.content,
  createdAt: message.createdAt
}));

const getConversation = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to use Career Assistant." });
    const conversation = await CareerAssistantConversation.findOne({ userId }).select("messages updatedAt").lean();
    return res.json({ success: true, messages: publicMessages(conversation?.messages || []) });
  } catch (error) {
    console.error("Load Career Assistant conversation:", error);
    return res.status(500).json({ success: false, message: "Unable to load your conversation." });
  }
};

const sendMessage = async (req, res) => {
  try {
    const userId = userIdOf(req);
    const message = clean(req.body?.message);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to use Career Assistant." });
    if (!message) return res.status(400).json({ success: false, message: "Enter a message first." });
    if (message.length > 2000) return res.status(400).json({ success: false, message: "Messages must be 2,000 characters or fewer." });

    const [user, career, shortlist, conversation] = await Promise.all([
      User.findById(userId).select("fullName targetRole lookingFor preferredLocation preferredWorkMode preferredIndustry skills resumeSkills resumeText projects experience certifications education yearsOfExperience").lean(),
      CareerDevelopment.findOne({ userId }).lean(),
      JobShortlist.find({ userId }).sort({ createdAt: -1 }).limit(15).lean(),
      CareerAssistantConversation.findOne({ userId })
    ]);
    if (!user) return res.status(404).json({ success: false, message: "Your profile could not be found." });

    const savedIds = shortlist.map((item) => item.jobId).filter(Boolean);
    const savedJobs = await Job.find({ _id: { $in: savedIds } })
      .select("title company location workMode experience experienceLevel salary skills detectedJobSkills description jobUrl applicationUrl")
      .lean();
    const savedById = new Map(savedJobs.map((job) => [String(job._id), job]));
    const savedJobContext = shortlist.map((item) => {
      const job = savedById.get(String(item.jobId));
      const snapshot = item.jobSnapshot || {};
      const source = job || snapshot;
      return {
        title: source.title || "", company: source.company || "", location: source.location || "",
        workMode: source.workMode || "", experience: source.experience || source.experienceLevel || "",
        skills: (source.skills || source.detectedJobSkills || []).slice(0, 12),
        description: clean(source.description).slice(0, 220),
        listingAvailable: Boolean(job)
      };
    });

    const roadmap = (career?.missingSkillsRoadmap || []).map((item) => ({
      skill: item.skill, priority: item.priority, status: item.status,
      reason: item.reason, topics: (item.topics || []).slice(0, 8),
      estimatedWeeks: item.estimatedWeeks,
      project: item.project ? { title: item.project.title, status: item.project.status } : null,
      assessment: item.assessment ? { verified: Boolean(item.assessment.verified), passPercentage: item.assessment.passPercentage } : null
    }));
    const weeklyPlan = (career?.missingSkillsWeeklyPlan || []).map((week) => ({
      weekNumber: week.weekNumber, title: week.title,
      tasks: (week.tasks || []).map((task) => ({ title: task.title, skill: task.skill, completed: Boolean(task.completed) }))
    }));
    const careerRoadmap = (career?.roadmap || []).map((item) => ({
      skill: item.skill, priority: item.priority, status: item.status, estimatedWeeks: item.estimatedWeeks
    }));

    const profileContext = {
      name: user.fullName,
      targetRole: user.targetRole,
      careerInterests: career?.interests || [],
      selectedCareerPath: career?.selectedRole || "",
      profileSkills: user.skills || [],
      resumeExtractedSkills: user.resumeSkills || [],
      resumeText: clean(user.resumeText).slice(0, 6500),
      projects: (user.projects || []).slice(0, 8),
      experience: (user.experience || []).slice(0, 8),
      certifications: (user.certifications || []).slice(0, 10),
      education: (user.education || []).slice(0, 4),
      yearsOfExperience: user.yearsOfExperience,
      preferences: {
        lookingFor: user.lookingFor, preferredLocation: user.preferredLocation,
        preferredWorkMode: user.preferredWorkMode, preferredIndustry: user.preferredIndustry
      },
      savedJobs: savedJobContext,
      missingSkillsRoadmap: roadmap,
      weeklyLearningPlan: weeklyPlan,
      careerNavigatorRoadmap: careerRoadmap
    };

    const previousMessages = (conversation?.messages || []).slice(-12).map((item) => ({
      role: item.role, content: item.content
    }));
    const prompt = [
      "You are JobPulse AI Career Assistant, a practical and supportive career coach for technology students and professionals.",
      "Use the authenticated user's supplied JobPulse context to personalise answers. Never claim to have accessed data that is absent. Clearly say when information is unavailable and suggest where in JobPulse it can be added.",
      "Answer the user's actual question first. Be clear, actionable, encouraging and appropriately concise. Use Markdown in the reply when useful. Do not invent job details, resume facts, learning progress, hiring status, links, or statistics.",
      "For job questions, refer only to the supplied saved jobs unless the user explicitly asks for general job-search advice. For roadmap questions, distinguish not-started, in-progress, completed and verified states accurately.",
      "For interview preparation, ask one question at a time when conducting a mock interview. When evaluating an answer, give strengths, improvements and a stronger sample answer.",
      "Return valid JSON only with this shape: { \"reply\": \"the assistant response as a string\", \"suggestedQuestions\": [\"optional follow-up\"] }. Provide 0 to 3 short relevant suggested questions.",
      "USER JOBPULSE CONTEXT: " + JSON.stringify(profileContext),
      "RECENT CONVERSATION: " + JSON.stringify(previousMessages),
      "USER MESSAGE: " + message
    ].join("\n\n");

    const generated = await askGemini(prompt, "AI Career Assistant chat");
    const reply = clean(generated.reply);
    if (!reply) return res.status(502).json({ success: false, message: "Gemini returned an empty answer. Please try again." });

    const doc = conversation || new CareerAssistantConversation({ userId, messages: [] });
    doc.messages.push({ role: "user", content: message });
    doc.messages.push({ role: "assistant", content: reply });
    if (doc.messages.length > 40) doc.messages = doc.messages.slice(-40);
    await doc.save();

    return res.json({
      success: true,
      message: { role: "assistant", content: reply, createdAt: new Date() },
      suggestedQuestions: (Array.isArray(generated.suggestedQuestions) ? generated.suggestedQuestions : []).map(clean).filter(Boolean).slice(0, 3),
      contextUsed: {
        resume: Boolean(user.resumeText || user.resumeSkills?.length),
        skills: Boolean(user.skills?.length || user.resumeSkills?.length),
        targetRole: Boolean(user.targetRole),
        careerInterests: Boolean(career?.interests?.length),
        savedJobs: savedJobContext.length,
        missingSkillsRoadmap: roadmap.length,
        weeklyPlan: weeklyPlan.length
      }
    });
  } catch (error) {
    console.error("Career Assistant chat:", error.response?.status || error.status, error.message);
    return res.status(error.status || 502).json({
      success: false,
      message: error.message || "The Career Assistant could not respond right now. Please try again."
    });
  }
};

const clearConversation = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in first." });
    await CareerAssistantConversation.deleteOne({ userId });
    return res.json({ success: true, message: "Conversation cleared." });
  } catch (error) {
    console.error("Clear Career Assistant conversation:", error);
    return res.status(500).json({ success: false, message: "Unable to clear your conversation." });
  }
};

module.exports = { getConversation, sendMessage, clearConversation };
