const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getOverview,
  savePreferences,
  generateRoadmap,
  updateRoadmapStatus,
} = require("../controllers/careerDevelopmentController");

const router = express.Router();
const { getInterestOptions, generateCareerRecommendations, generateGeminiRoadmap } = require("../controllers/geminiCareerController");
router.use(authMiddleware);
router.get("/", getOverview);
router.get("/ai/interests", getInterestOptions);
router.post("/ai/recommendations", generateCareerRecommendations);
router.post("/ai/roadmap", generateGeminiRoadmap);
router.put("/preferences", savePreferences);
router.post("/roadmap", generateRoadmap);
router.patch("/roadmap/:itemId/status", updateRoadmapStatus);

module.exports = router;
