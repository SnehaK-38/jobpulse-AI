const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getShortlist,
  addToShortlist,
  removeFromShortlist,
} = require("../controllers/jobShortlistController");

const router = express.Router();

router.get("/", authMiddleware, getShortlist);
router.post("/", authMiddleware, addToShortlist);
router.delete("/:jobId", authMiddleware, removeFromShortlist);

module.exports = router;
