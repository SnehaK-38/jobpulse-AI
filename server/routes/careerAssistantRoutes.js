const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getConversation,
  sendMessage,
  clearConversation
} = require("../controllers/careerAssistantController");

const router = express.Router();
router.use(authMiddleware);
router.get("/conversation", getConversation);
router.post("/chat", sendMessage);
router.delete("/conversation", clearConversation);

module.exports = router;
