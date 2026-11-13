const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  listConversations, createConversation, getConversation, sendMessage, deleteConversation
} = require("../controllers/careerAssistantController");

const { getGeminiStatus } = require("../controllers/geminiCareerController");

const router = express.Router();
router.use(authMiddleware);
router.get("/gemini-status", getGeminiStatus);
router.get("/conversations", listConversations);
router.post("/conversations", createConversation);
router.get("/conversations/:id", getConversation);
router.post("/conversations/:id/chat", sendMessage);
router.delete("/conversations/:id", deleteConversation);

module.exports = router;
