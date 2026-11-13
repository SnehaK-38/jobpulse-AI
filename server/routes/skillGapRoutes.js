const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { getSkillGapOverview } = require("../controllers/skillGapController");
const { generateMissingSkillsRoadmap, updateMissingSkillStatus } = require("../controllers/missingSkillsRoadmapController");

const router = express.Router();

router.post("/overview", authMiddleware, getSkillGapOverview);
router.post("/roadmap", authMiddleware, generateMissingSkillsRoadmap);
router.patch("/roadmap/:itemId/status", authMiddleware, updateMissingSkillStatus);

module.exports = router;
