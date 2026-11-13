const axios = require("axios");
const CareerDevelopment = require("../models/CareerDevelopment");
const User = require("../models/User");
const Job = require("../models/Job");

const clean = (v) => String(v == null ? "" : v).trim();
const norm = (v) => clean(v).toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const unique = (items) => [...new Map((items || []).map((v) => [norm(v), clean(v)]).filter(([k,v]) => k && v)).values()];
let interestCache = { value: null, expiresAt: 0 };

const askGemini = async (prompt) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const error = new Error("Gemini is not configured. Add GEMINI_API_KEY to server/.env and restart the backend.");
    error.status = 503;
    throw error;
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(key);
  const response = await axios.post(url, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.35, maxOutputTokens: 7000 }
  }, { timeout: 60000 });
  const text = response.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty response. Please try again.");
  try { return JSON.parse(text.replace(/^\u0060{3}(?:json)?\s*/i, "").replace(/\s*\u0060{3}$/i, "")); }
  catch { throw new Error("Gemini returned an invalid structured response. Please try again."); }
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
    console.error("Gemini career interests:", error.response?.data || error.message);
    return res.status(error.status || 502).json({ success: false, message: error.response?.data?.error?.message || error.message || "Unable to generate career interests with Gemini." });
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
    const data = await askGemini("Act as a careful career advisor. Based on this user's selected interests, existing skills and sampled job-market examples, generate 18 to 30 relevant IT/technology career paths. Do not limit yourself to a fixed list. Include adjacent realistic roles, but do not invent job counts. Return JSON only with { roles: [{ title, industry, interests: string[], skills: string[], nextRoles: string[], summary }] }. Each role must have 5-12 concrete skills, 2-5 matching interests and 2-3 plausible next roles. Avoid duplicate/synonym roles. Prioritize the selected interests; every role must match at least one selected interest. Include a diverse mix of entry-level and specialist roles. User interests: " + JSON.stringify(interests) + ". User skills: " + JSON.stringify(skills) + ". Target role: " + clean(user.targetRole) + ". Preferred industry: " + clean(user.preferredIndustry) + ". Job listing sample (examples only, not a census): " + JSON.stringify(jobContext));
    const roles = (data.roles || []).map((r) => ({
      title: clean(r.title).slice(0, 100), industry: clean(r.industry).slice(0, 80),
      interests: unique(r.interests).filter((x) => interests.some((i) => norm(i) === norm(x))),
      skills: unique(r.skills).slice(0, 15), nextRoles: unique(r.nextRoles).slice(0, 5),
      summary: clean(r.summary).slice(0, 350)
    })).filter((r) => r.title && r.skills.length >= 3 && r.interests.length);
    if (roles.length < 5) throw new Error("Gemini returned too few valid career paths. Please generate recommendations again.");
    const savedDoc = await CareerDevelopment.findOneAndUpdate(
      { userId }, { $set: { interests, generatedRoles: roles, generatedRolesAt: new Date(), selectedRole: "" } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, roles: savedDoc.generatedRoles, generatedAt: savedDoc.generatedRolesAt });
  } catch (error) {
    console.error("Gemini career recommendations:", error.response?.data || error.message);
    return res.status(error.status || 502).json({ success: false, message: error.response?.data?.error?.message || error.message || "Gemini could not generate career recommendations." });
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
    if (!missing.length) return res.status(400).json({ success: false, message: "Your profile already matches the listed skills for this role." });
    const data = await askGemini("Create a practical beginner-to-intermediate learning roadmap for this career. Return JSON only: { items: [{ skill, priority, reason, estimatedWeeks, topics: string[], resourceTitle, resourceUrl, practiceTask }] }. Create one item for every missing skill provided, combine closely related skills only if necessary, 2-4 topics per item, 1-8 estimated weeks, priority High/Medium/Low. Prefer official documentation or reputable free learning resources; URLs must be plausible canonical links, never fabricate a URL if uncertain (use an empty resourceUrl). Give actionable project tasks. Role: " + role.title + ". Missing skills: " + JSON.stringify(missing) + ". Existing skills: " + JSON.stringify(skills) + ".");
    const previousStatus = new Map((saved?.roadmap || []).map((item) => [norm(item.skill), item.status]));
    const items = (data.items || []).map((item, index) => ({
      skill: clean(item.skill), priority: ["High","Medium","Low"].includes(item.priority) ? item.priority : "Medium",
      reason: clean(item.reason), estimatedWeeks: Math.max(1, Math.min(52, Number(item.estimatedWeeks) || 2)),
      status: previousStatus.get(norm(item.skill)) || "Not Started",
      topics: unique(item.topics).slice(0, 6),
      resource: { title: clean(item.resourceTitle), url: /^https?:\/\//i.test(clean(item.resourceUrl)) ? clean(item.resourceUrl) : "" },
      practiceTask: clean(item.practiceTask), order: index + 1
    })).filter((item) => item.skill && item.topics.length);
    if (items.length < Math.min(2, missing.length)) throw new Error("Gemini returned an incomplete learning roadmap. Please try again.");
    const result = await CareerDevelopment.findOneAndUpdate(
      { userId }, { $set: { selectedRole: role.title, roadmap: items, roadmapUpdatedAt: new Date() } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ success: true, roadmap: result.roadmap, selectedRole: result.selectedRole });
  } catch (error) {
    console.error("Gemini learning roadmap:", error.response?.data || error.message);
    return res.status(error.status || 502).json({ success: false, message: error.response?.data?.error?.message || error.message || "Gemini could not generate the learning roadmap." });
  }
};

module.exports = { getInterestOptions, generateCareerRecommendations, generateGeminiRoadmap };
