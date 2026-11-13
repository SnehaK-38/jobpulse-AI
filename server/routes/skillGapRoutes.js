const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { getSkillGapOverview } = require("../controllers/skillGapController");
const { getMissingSkillsRoadmap, generateMissingSkillsRoadmap, updateMissingSkillStatus } = require("../controllers/missingSkillsRoadmapController");

const router = express.Router();

router.post("/overview", authMiddleware, getSkillGapOverview);
router.get("/roadmap", authMiddleware, getMissingSkillsRoadmap);
router.post("/roadmap", authMiddleware, generateMissingSkillsRoadmap);
router.patch("/roadmap/:itemId/status", authMiddleware, updateMissingSkillStatus);

module.exports = router;
