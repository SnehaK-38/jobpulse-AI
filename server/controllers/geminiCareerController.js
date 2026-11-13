const axios = require("axios");
const CareerDevelopment = require("../models/CareerDevelopment");
const User = require("../models/User");
const Job = require("../models/Job");

const clean = (v) => String(v == null ? "" : v).trim();
const norm = (v) => clean(v).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const unique = (items) => [...new Map((items || []).map((v) => [norm(v), clean(v)]).filter(([k,v]) => k && v)).values()];
let interestCache = { value: null, expiresAt: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTemporaryGeminiError = (error) => {
  const status = error.response?.status || error.status;
  return status === 503 || status === 502 || status === 504 || status === 429 || !status;
};
const getGeminiErrorMessage = (error) => {
  const status = error.response?.status || error.status;
  const apiMessage = error.response?.data?.error?.message;
  if (status === 503 || status === 502 || status === 504) {
    return "Gemini is temporarily busy. The app retried the request and tried its backup model. Please wait a minute and try again.";
  }
  if (status === 429) {
    return "Gemini request limit reached for this project or model. Please wait for the limit to reset, then try again.";
  }
  if (status === 403) {
    return "Google denied access to this Gemini project. Check the project's status and API key permissions in Google AI Studio.";
  }
  if (status === 400) return apiMessage || "Gemini rejected the request. Check the model and request configuration.";
  return apiMessage || error.message || "Gemini could not complete the request.";
};

const askGemini = async (prompt) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const error = new Error("Gemini is not configured. Add GEMINI_API_KEY to server/.env and restart the backend.");
    error.status = 503;
    throw error;
  }

  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
  const models = [...new Set([primaryModel, fallbackModel])];
  let lastError;

  for (const model of models) {
    const attempts = model === primaryModel ? 3 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key);
        const response = await axios.post(url, {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.35, maxOutputTokens: 7000 }
        }, { timeout: 60000 });

        const output = response.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
        if (!output) throw new Error("Gemini returned an empty response. Please try again.");
        try {
          return JSON.parse(output.replace(/^\u0060{3}(?:json)?\s*/i, "").replace(/\s*\u0060{3}$/i, ""));
        } catch {
          throw new Error("Gemini returned an invalid structured response. Please try again.");
        }
      } catch (error) {
        lastError = error;
        if (!isTemporaryGeminiError(error)) throw error;
        const status = error.response?.status || error.status;
        if (status === 429 && attempt === attempts - 1) break;
        if (attempt < attempts - 1) {
          const delay = Math.min(8000, 1000 * (2 ** attempt)) + Math.floor(Math.random() * 400);
          console.warn("Gemini model " + model + " temporarily unavailable; retry " + (attempt + 1) + "/" + (attempts - 1) + " in " + delay + "ms.");
          await sleep(delay);
        }
      }
    }
    console.warn("Gemini primary/fallback model attempt ended for " + model + ".");
  }

  const finalError = new Error(getGeminiErrorMessage(lastError || new Error("Unknown Gemini error")));
  finalError.status = lastError?.response?.status || lastError?.status || 503;
  finalError.cause = lastError;
  throw finalError;
};

const userIdOf = (req) => req.user && (req.user._id || req.user.id || req.user.userId);

const getInterestOptions = async (req, res) => {
  try {
    if (interestCache.value && interestCache.expiresAt > Date.now()) {
      return res.json({ success: true, interests: interestCache.value, source: "gemini-cache" });
    }
    const data = await askGemini("Create a broad, current career-interest taxonomy for IT/computer science students exploring careers. Return JSON only: { interests: string[] }. Provide 55 to 70 concise, distinct selectable interest labels across software, web, mobile, data, AI, testing, cloud, security, networking, design, product, infrastructure, and business technology. Use natural labels, avoid duplicates and overly narrow vendor certifications.");
    const interests = unique(data.interests).slice(0, 70);
    if (interests.length < 20) throw new Error("Gemini returned too few career interests. Please retry.");
    interestCache = { value: interests, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    return res.json({ success: true, interests, source: "gemini" });
  } catch (error) {
    console.error("Gemini career interests:", error.response?.status || error.status, getGeminiErrorMessage(error));
    return res.status(error.status || 502).json({ success: false, message: getGeminiErrorMessage(error) });
  }
};

const generateCareerRecommendations = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to generate recommendations." });
    const [user, saved, jobs] = await Promise.all([
      User.findById(userId).select("skills resumeSkills targetRole preferredIndustry preferredLocation").lean(),
      CareerDevelopment.findOne({ userId }).lean(),
      Job.find({}).sort({ scrapedAt: -1 }).limit(120).select("title skills detectedJobSkills description requirements").lean()
    ]);
    if (!user) return res.status(404).json({ success: false, message: "User profile not found." });
    const interests = unique(req.body?.interests || saved?.interests || []).slice(0, 12);
    if (!interests.length) return res.status(400).json({ success: false, message: "Select and save at least one career interest first." });
    const skills = unique([...(user.skills || []), ...(user.resumeSkills || [])]);
    const jobContext = jobs.slice(0, 80).map((j) => ({ title: j.title, skills: (j.skills || j.detectedJobSkills || []).slice(0, 12), description: clean(j.description).slice(0, 240) }));
    const data = await askGemini("Act as an independent occupational research and career advisor. Generate 18 to 30 realistic IT/technology career paths relevant to selected interests. Define each role's standard required competencies independently of the user's current skills. Do NOT copy, favour, or limit required skills to the user's existing skills. Include genuine role-specific technical skills, tools, methods and domain knowledge; avoid generic editor/tool names (such as VS Code) and generic skills unless essential. Each role must have 7-12 concrete role-specific skills, 2-5 relevant interest tags and 2-3 plausible progression roles. Return JSON only with { roles: [{ title, industry, interests: string[], skills: string[], nextRoles: string[], summary }] }. Every role must match at least one selected interest, but retain all relevant interest tags rather than filtering them to selected interests. Do not invent job counts. Avoid duplicate roles and include entry-level through specialist roles. User interests: " + JSON.stringify(interests) + ". The following profile skills are for matching only; do not copy them into the role requirements unless they are genuinely core to the occupation: " + JSON.stringify(skills) + ". Target role: " + clean(user.targetRole) + ". Preferred industry: " + clean(user.preferredIndustry) + ". Job listing sample (examples only, not a census): " + JSON.stringify(jobContext));
    const roles = (data.roles || []).map((r) => ({
      title: clean(r.title).slice(0, 100), industry: clean(r.industry).slice(0, 80),
      interests: unique(r.interests).filter((x) => interests.some((i) => norm(i) === norm(x))),
      skills: unique(r.skills).slice(0, 15), nextRoles: unique(r.nextRoles).slice(0, 5),
      summary: clean(r.summary).slice(0, 350)
    })).filter((r) => r.title && r.skills.length >= 3 && r.interests.length);
    if (roles.length < 5) throw new Error("Gemini returned too few valid career paths. Please generate recommendations again.");
    const savedDoc = await CareerDevelopment.findOneAndUpdate(
      { userId }, { $set: { interests, generatedRoles: roles, generatedRolesAt: new Date(), selectedRole: "" } },
      { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, roles: savedDoc.generatedRoles, generatedAt: savedDoc.generatedRolesAt });
  } catch (error) {
    console.error("Gemini career recommendations:", error.response?.status || error.status, getGeminiErrorMessage(error));
    return res.status(error.status || 502).json({ success: false, message: getGeminiErrorMessage(error) });
  }
};

const generateGeminiRoadmap = async (req, res) => {
  try {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: "Please log in to generate a roadmap." });
    const roleName = clean(req.body?.role);
    const [saved, user, jobs] = await Promise.all([
      CareerDevelopment.findOne({ userId }).lean(),
      User.findById(userId).select("skills resumeSkills").lean(),
      Job.find({}).sort({ scrapedAt: -1 }).limit(120).select("title skills detectedJobSkills").lean()
    ]);
    const role = (saved?.generatedRoles || []).find((r) => norm(r.title) === norm(roleName));
    if (!role) return res.status(400).json({ success: false, message: "Generate AI career recommendations and select one of those roles first." });
    const skills = unique([...(user?.skills || []), ...(user?.resumeSkills || [])]);
    const missing = role.skills.filter((skill) => !skills.some((s) => norm(s) === norm(skill)));
    const roadmapTargets = missing;
    const roadmapMode = missing.length ? "skill-gap development" : "career advancement: the user already matches the listed core skills, so suggest deeper intermediate-to-advanced competencies that extend them; do not simply repeat existing skills.";
    const data = await askGemini("Create a practical personalised learning roadmap. Mode: " + roadmapMode + ". Return JSON only: { items: [{ skill, priority, reason, estimatedWeeks, topics: string[], resourceTitle, resourceUrl, practiceTask }] }. If target skills is non-empty, create one item for every target skill and do not omit any. If target skills is empty, generate 5-7 complementary intermediate-to-advanced competencies for the next stage of this career, and do not repeat existing skills. Provide 2-4 actionable topics per item, 1-8 estimated weeks, priority High/Medium/Low. Use official documentation URLs only when confident; otherwise use an empty resourceUrl and a useful resourceTitle. Never fabricate URLs. Give practical project tasks. Role: " + role.title + ". Target skills: " + JSON.stringify(roadmapTargets) + ". Existing skills: " + JSON.stringify(skills) + ".");
    const previousStatus = new Map((saved?.roadmap || []).map((item) => [norm(item.skill), item.status]));
    const items = (data.items || []).map((item, index) => ({
      skill: clean(item.skill), priority: ["High","Medium","Low"].includes(item.priority) ? item.priority : "Medium",
      reason: clean(item.reason), estimatedWeeks: Math.max(1, Math.min(52, Number(item.estimatedWeeks) || 2)),
      status: previousStatus.get(norm(item.skill)) || "Not Started",
      topics: unique(item.topics).slice(0, 6),
      resource: { title: clean(item.resourceTitle), url: /^https?:\/\//i.test(clean(item.resourceUrl)) ? clean(item.resourceUrl) : "" },
      practiceTask: clean(item.practiceTask), order: index + 1
    })).filter((item) => item.skill && item.topics.length);
    if (items.length < (roadmapTargets.length ? Math.min(2, roadmapTargets.length) : 3)) throw new Error("Gemini returned an incomplete learning roadmap. Please try again.");
    const result = await CareerDevelopment.findOneAndUpdate(
      { userId }, { $set: { selectedRole: role.title, roadmap: items, roadmapUpdatedAt: new Date() } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, roadmap: result.roadmap, selectedRole: result.selectedRole });
  } catch (error) {
    console.error("Gemini learning roadmap:", error.response?.status || error.status, getGeminiErrorMessage(error));
    return res.status(error.status || 502).json({ success: false, message: error.response?.data?.error?.message || error.message || "Gemini could not generate the learning roadmap." });
  }
};

module.exports = { getInterestOptions, generateCareerRecommendations, generateGeminiRoadmap };
