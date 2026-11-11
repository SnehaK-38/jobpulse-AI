const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({
  path: require("fs").existsSync(path.resolve(__dirname, ".env"))
    ? path.resolve(__dirname, ".env")
    : path.resolve(__dirname, "..", ".env"),
});

const app = express();

const authRoutes = require("./routes/authRoutes");
const resumeRoutes = require("./routes/resumeRoutes");
const profileRoutes = require("./routes/profileRoutes");
const profilePhotoRoutes = require("./routes/profilePhotoRoutes");
const jobRoutes = require("./routes/jobRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const skillGapRoutes = require("./routes/skillGapRoutes");
const careerRoadmapRoutes = require("./routes/careerRoadmapRoutes");

const connectDB = require("./config/db");
connectDB();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "🚀 JobPulse AI Backend Running",
    architecture: "Cache-first job search",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/resume", resumeRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/profile-photo", profilePhotoRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/skill-gap", skillGapRoutes);
app.use("/api/career-roadmap", careerRoadmapRoutes);

app.use((error, req, res, next) => {
  console.error("Express error:", error);
  if (res.headersSent) return next(error);
  return res.status(500).json({
    success: false,
    message: "Internal server error",
    error: error.message,
  });
});

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log("\n==============================================");
  console.log("🚀 JOBPULSE BACKEND");
  console.log("==============================================");
  console.log(`Server: http://localhost:${PORT}`);
  console.log("Search mode: MongoDB cache-first");
  console.log("Background scraper: Python JobSpy");
  console.log("Semantic ranking: Python SentenceTransformer");
  console.log("==============================================\n");
});
