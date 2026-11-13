const express = require("express");

const authMiddleware =
  require("../middleware/authMiddleware");

const {
  searchJobs,
  getStoredJobs,
  refreshJobs,
} = require("../controllers/jobController");


const router =
  express.Router();


/*
 * Fresh jobs from JobSpy
 */
router.get(
  "/search",
  authMiddleware,
  searchJobs
);

router.post(
  "/refresh",
  authMiddleware,
  refreshJobs
);


/*a
 * Jobs already stored in MongoDB
 */
router.get(
  "/",
  authMiddleware,
  getStoredJobs
);


module.exports =
  router;