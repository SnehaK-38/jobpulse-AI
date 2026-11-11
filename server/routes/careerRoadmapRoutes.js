const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { getCareerRoadmap, generateCareerRoadmap, updateSkillStatus } = require("../controllers/careerRoadmapController");
const router = express.Router();
router.get("/", authMiddleware, getCareerRoadmap);
router.post("/generate", authMiddleware, generateCareerRoadmap);
router.patch("/skills/:skillId/status", authMiddleware, updateSkillStatus);
module.exports = router;
