const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const { getSkillGapOverview } = require("../controllers/skillGapController");

const router = express.Router();

router.post("/overview", authMiddleware, getSkillGapOverview);

module.exports = router;
