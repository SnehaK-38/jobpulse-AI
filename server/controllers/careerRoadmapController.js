const crypto = require("crypto");
const mongoose = require("mongoose");
const CareerRoadmap = require("../models/CareerRoadmap");
const User = require("../models/User");

const clean = (value) => String(value == null ? "" : value).trim();
const normalize = (value) => clean(value).toLowerCase().replace(/\s+/g, " ");
const getUserId = (req) => req.user && (req.user._id || req.user.id || req.user.userId);

const OFFICIAL_RESOURCES = [
  { match: ["javascript", "html", "css"], title: "MDN Web Docs", url: "https://developer.mozilla.org/" },
  { match: ["typescript"], title: "TypeScript Handbook", url: "https://www.typescriptlang.org/docs/" },
  { match: ["react", "react.js"], title: "React Documentation", url: "https://react.dev/learn" },
  { match: ["next.js"], title: "Next.js Documentation", url: "https://nextjs.org/docs" },
  { match: ["node.js", "nodejs"], title: "Node.js Documentation", url: "https://nodejs.org/docs/latest/api/" },
  { match: ["express", "express.js"], title: "Express Documentation", url: "https://expressjs.com/" },
  { match: ["mongodb"], title: "MongoDB Documentation", url: "https://www.mongodb.com/docs/" },
  { match: ["python"], title: "Python Documentation", url: "https://docs.python.org/3/" },
  { match: ["java"], title: "Java Documentation", url: "https://dev.java/learn/" },
  { match: ["sql", "mysql"], title: "MySQL Documentation", url: "https://dev.mysql.com/doc/" },
  { match: ["postgresql"], title: "PostgreSQL Documentation", url: "https://www.postgresql.org/docs/" },
  { match: ["docker"], title: "Docker Documentation", url: "https://docs.docker.com/" },
  { match: ["kubernetes"], title: "Kubernetes Documentation", url: "https://kubernetes.io/docs/" },
  { match: ["git"], title: "Git Documentation", url: "https://git-scm.com/doc" },
  { match: ["machine learning", "scikit-learn"], title: "scikit-learn User Guide", url: "https://scikit-learn.org/stable/user_guide.html" },
  { match: ["pytorch"], title: "PyTorch Tutorials", url: "https://pytorch.org/tutorials/" },
  { match: ["tensorflow"], title: "TensorFlow Tutorials", url: "https://www.tensorflow.org/tutorials" },
  { match: ["aws"], title: "AWS Documentation", url: "https://docs.aws.amazon.com/" },
  { match: ["azure"], title: "Microsoft Learn", url: "https://learn.microsoft.com/" },
];

const getOfficialResource = (skillName) => {
  const key = normalize(skillName);
  const match = OFFICIAL_RESOURCES.find((item) => item.match.includes(key));
  if (match) return { title: match.title, url: match.url };
  return {
    title: "Search official documentation",
    url: "https://www.google.com/search?q=" + encodeURIComponent(skillName + " official documentation"),
  };
};

const getGeminiJson = async (targetRole, currentSkills, missingSkills) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("Gemini is not configured. Add GEMINI_API_KEY to your server environment, then restart the backend.");
    error.statusCode = 503;
    throw error;
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const prompt = [
    "You are a careful technical learning-path designer.",
    "Create a personalized, practical learning sequence for the target career role.",
    "This is a suggested learning path, NOT a complete or official syllabus. Never claim it covers every topic or guarantees job readiness.",
    "Only create roadmap entries for the exact missing skills supplied below. Do not add unrelated skills.",
    "For each skill, create 4 to 7 well-ordered learning topics from foundations to role-relevant application.",
    "For each topic provide: title, overview, concise study notes (roughly 70-120 words), 3-6 keyPoints, one practical practiceTask, and estimatedHours (a realistic number).",
    "Use the learner's existing skills to avoid teaching prerequisites they already know.",
    "List prerequisites only when genuinely needed. If a prerequisite is already in currentSkills, mention it in the reason but do not add it as a missing roadmap skill.",
    "Arrange the missing skills in a sensible order. Use High priority as a preference when multiple sequences are valid, but never violate prerequisites. If one missing skill depends on another, place the prerequisite first.",
    "Do not generate URLs, video IDs, course names, or unverifiable resource links. The application supplies trusted documentation links and YouTube search results separately.",
    "Return valid JSON only with this exact shape:",
    '{"learningPath":[{"skill":"exact supplied skill name","reason":"short role-specific explanation","prerequisites":["existing or other supplied skill"],"topics":[{"title":"...","overview":"...","notes":"...","keyPoints":["..."],"practiceTask":"...","estimatedHours":2}]}]}',
    "Target role: " + targetRole,
    "Current skills: " + JSON.stringify(currentSkills),
    "Missing skills with existing priority labels: " + JSON.stringify(missingSkills),
  ].join("\n\n");

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent";
  const response = await fetch(endpoint + "?" + new URLSearchParams({ key: apiKey }).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.25, maxOutputTokens: 24576 },
    }),
    signal: AbortSignal.timeout(90000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Gemini roadmap API error:", payload.error && payload.error.message ? payload.error.message : response.status);
    const error = new Error("The AI service could not generate the roadmap. Check the Gemini API key, model access and quota, then try again.");
    error.statusCode = response.status === 429 ? 503 : 502;
    throw error;
  }

  const text = payload.candidates && payload.candidates[0] &&
    payload.candidates[0].content && payload.candidates[0].content.parts
    ? payload.candidates[0].content.parts.map((part) => part.text || "").join("").trim()
    : "";
  if (!text) {
    const error = new Error("The AI service returned an empty roadmap. Please try again.");
    error.statusCode = 502;
    throw error;
  }

  try {
    return JSON.parse(text.replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, ""));
  } catch (parseError) {
    console.error("Could not parse Gemini roadmap JSON:", parseError.message);
    const error = new Error("The AI response was not in the expected format. Please generate the roadmap again.");
    error.statusCode = 502;
    throw error;
  }
};

const getYoutubeVideos = async (skillName, targetRole) => {
  const query = skillName + " tutorial for " + targetRole;
  const youtubeSearchUrl = "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { youtubeSearchUrl, youtubeVideos: [] };

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.search = new URLSearchParams({
      part: "snippet", type: "video", maxResults: "3", q: query,
      key: apiKey, safeSearch: "strict", relevanceLanguage: "en",
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { youtubeSearchUrl, youtubeVideos: [] };
    const youtubeVideos = (payload.items || [])
      .filter((item) => item.id && item.id.videoId && item.snippet && item.snippet.title)
      .map((item) => ({
        title: item.snippet.title,
        channel: item.snippet.channelTitle || "",
        url: "https://www.youtube.com/watch?v=" + item.id.videoId,
        thumbnail: item.snippet.thumbnails && item.snippet.thumbnails.medium
          ? item.snippet.thumbnails.medium.url
          : "",
      }));
    return { youtubeSearchUrl, youtubeVideos };
  } catch (error) {
    console.warn("YouTube recommendations unavailable; using search link:", error.message);
    return { youtubeSearchUrl, youtubeVideos: [] };
  }
};

const getCareerRoadmap = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to view your career roadmap." });
    const roadmap = await CareerRoadmap.findOne({ userId }).lean();
    return res.json({ success: true, roadmap });
  } catch (error) {
    console.error("getCareerRoadmap error:", error);
    return res.status(500).json({ success: false, message: "Unable to load your career roadmap." });
  }
};

const generateCareerRoadmap = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to generate a career roadmap." });

    const user = await User.findById(userId).select("targetRole skills resumeSkills").lean();
    if (!user) return res.status(404).json({ success: false, message: "User profile not found." });

    const targetRole = clean(user.targetRole);
    if (!targetRole) return res.status(400).json({ success: false, message: "Set a target role in your profile before generating a roadmap." });
    const requestedTargetRole = clean(req.body && req.body.targetRole);
    if (requestedTargetRole && normalize(requestedTargetRole) !== normalize(targetRole)) {
      return res.status(409).json({ success: false, message: "Your target role changed after this analysis. Refresh Skill Gap Analysis, then generate the roadmap again." });
    }

    const suppliedSkills = Array.isArray(req.body && req.body.missingSkills) ? req.body.missingSkills : [];
    const currentSkills = Array.from(new Set([
      ...(Array.isArray(user.resumeSkills) ? user.resumeSkills : []),
      ...(Array.isArray(user.skills) ? user.skills : []),
    ].map(clean).filter(Boolean)));

    const validPriorities = new Set(["High", "Medium", "Low"]);
    const missingSkills = suppliedSkills.slice(0, 30).map((item) => ({
      name: clean(item && item.name),
      priority: validPriorities.has(item && item.priority) ? item.priority : "Low",
    })).filter((item) => item.name &&
      !currentSkills.some((skill) => normalize(skill) === normalize(item.name)));

    if (!missingSkills.length) {
      return res.status(400).json({ success: false, message: "There are no missing skills to build a roadmap from. Refresh Skill Gap Analysis first." });
    }

    const aiResult = await getGeminiJson(targetRole, currentSkills, missingSkills);
    const aiEntries = Array.isArray(aiResult.learningPath) ? aiResult.learningPath : [];
    const requestedByName = new Map(missingSkills.map((item) => [normalize(item.name), item]));
    const previous = await CareerRoadmap.findOne({ userId }).lean();
    const previousByName = new Map((previous && previous.skills ? previous.skills : []).map((item) => [normalize(item.name), item]));

    const returnedSkillNames = new Set();
    const orderedSkills = aiEntries.map((entry) => {
      const requested = requestedByName.get(normalize(entry && entry.skill));
      if (!requested || returnedSkillNames.has(normalize(requested.name))) return null;
      returnedSkillNames.add(normalize(requested.name));
      const topics = (Array.isArray(entry.topics) ? entry.topics : []).slice(0, 8).map((topic) => ({
        title: clean(topic && topic.title).slice(0, 140),
        overview: clean(topic && topic.overview).slice(0, 700),
        notes: clean(topic && topic.notes).slice(0, 1800),
        keyPoints: (Array.isArray(topic && topic.keyPoints) ? topic.keyPoints : []).map(clean).filter(Boolean).slice(0, 8),
        practiceTask: clean(topic && topic.practiceTask).slice(0, 500),
        estimatedHours: Math.min(100, Math.max(0, Number(topic && topic.estimatedHours) || 1)),
      })).filter((topic) => topic.title && topic.notes);

      if (topics.length < 3) return null;
      const previousSkill = previousByName.get(normalize(requested.name));
      return {
        name: requested.name,
        priority: requested.priority,
        order: 0,
        reason: clean(entry && entry.reason).slice(0, 400),
        prerequisites: (Array.isArray(entry && entry.prerequisites) ? entry.prerequisites : []).map(clean).filter(Boolean).slice(0, 8),
        status: previousSkill && previousSkill.status ? previousSkill.status : "Not Started",
        topics,
        officialResource: getOfficialResource(requested.name),
        youtubeSearchUrl: "",
        youtubeVideos: [],
      };
    }).filter(Boolean);

    if (orderedSkills.length !== missingSkills.length || returnedSkillNames.size !== missingSkills.length) {
      const error = new Error("The AI did not return a complete learning path for every missing skill. Please try generating it again.");
      error.statusCode = 502;
      throw error;
    }

    const youtubeResults = await Promise.all(orderedSkills.map((skill) => getYoutubeVideos(skill.name, targetRole)));
    orderedSkills.forEach((skill, index) => {
      skill.order = index + 1;
      skill.youtubeSearchUrl = youtubeResults[index].youtubeSearchUrl;
      skill.youtubeVideos = youtubeResults[index].youtubeVideos;
    });

    const sourceFingerprint = crypto.createHash("sha256").update(JSON.stringify({
      targetRole: normalize(targetRole),
      currentSkills: currentSkills.map(normalize).sort(),
      missingSkills: missingSkills.map((item) => normalize(item.name)).sort(),
    })).digest("hex");

    const roadmap = await CareerRoadmap.findOneAndUpdate(
      { userId },
      { $set: { targetRole, sourceFingerprint, generatedAt: new Date(), skills: orderedSkills } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json({ success: true, roadmap });
  } catch (error) {
    console.error("generateCareerRoadmap error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Unable to generate your career roadmap.",
    });
  }
};

const updateSkillStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to update your roadmap." });
    if (!mongoose.isValidObjectId(req.params.skillId)) {
      return res.status(400).json({ success: false, message: "Invalid roadmap skill." });
    }
    const status = clean(req.body && req.body.status);
    if (!["Not Started", "In Progress", "Completed"].includes(status)) {
      return res.status(400).json({ success: false, message: "Choose a valid learning status." });
    }

    const roadmap = await CareerRoadmap.findOneAndUpdate(
      { userId, "skills._id": req.params.skillId },
      { $set: { "skills.$.status": status } },
      { new: true, runValidators: true }
    ).lean();

    if (!roadmap) return res.status(404).json({ success: false, message: "Roadmap skill not found." });
    return res.json({ success: true, roadmap });
  } catch (error) {
    console.error("updateSkillStatus error:", error);
    return res.status(500).json({ success: false, message: "Unable to update learning progress." });
  }
};

module.exports = { getCareerRoadmap, generateCareerRoadmap, updateSkillStatus };
