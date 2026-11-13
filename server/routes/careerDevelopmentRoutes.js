const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getOverview,
  savePreferences,
  generateRoadmap,
  updateRoadmapStatus,
} = require("../controllers/careerDevelopmentController");

const router = express.Router();
router.use(authMiddleware);
router.get("/", getOverview);
router.put("/preferences", savePreferences);
router.post("/roadmap", generateRoadmap);
router.patch("/roadmap/:itemId/status", updateRoadmapStatus);

module.exports = router;
