const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { getSkillGapOverview } = require("../controllers/skillGapController");
const { getMissingSkillsRoadmap, generateMissingSkillsRoadmap, updateMissingSkillStatus } = require("../controllers/missingSkillsRoadmapController");
const {
  generateWeeklyPlan, updateWeeklyTask, generateSkillProject, updateSkillProjectStatus,
  generateSkillAssessment, submitSkillAssessment
} = require("../controllers/missingSkillsLearningController");

const router = express.Router();

router.post("/overview", authMiddleware, getSkillGapOverview);
router.get("/roadmap", authMiddleware, getMissingSkillsRoadmap);
router.post("/roadmap", authMiddleware, generateMissingSkillsRoadmap);
router.patch("/roadmap/:itemId/status", authMiddleware, updateMissingSkillStatus);
router.post("/roadmap/weekly-plan", authMiddleware, generateWeeklyPlan);
router.patch("/roadmap/weekly-plan/:weekIndex/:taskIndex", authMiddleware, updateWeeklyTask);
router.post("/roadmap/:itemId/project", authMiddleware, generateSkillProject);
router.patch("/roadmap/:itemId/project/status", authMiddleware, updateSkillProjectStatus);
router.post("/roadmap/:itemId/assessment", authMiddleware, generateSkillAssessment);
router.post("/roadmap/:itemId/assessment/submit", authMiddleware, submitSkillAssessment);

module.exports = router;
