import { Routes, Route } from "react-router-dom";

import Home from "./pages/Home/Home";
import Login from "./pages/Login/Login";
import Signup from "./pages/Signup/Signup";
import ResumeUpload from "./pages/ResumeUpload/ResumeUpload";
import CareerProfile from "./pages/CareerProfile/CareerProfile";
import Dashboard from "./pages/Dashboard/Dashboard";
import JobDetails from "./pages/JobDetails/JobDetails";
import SkillGapAnalysis from "./pages/SkillGapAnalysis/SkillGapAnalysis";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/profile" element={<CareerProfile />} />
      <Route path="/resume-upload" element={<ResumeUpload />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/job-details" element={<JobDetails />} />
      <Route path="/career-tools" element={<SkillGapAnalysis />} />
      <Route path="/skill-gap" element={<SkillGapAnalysis />} />
    </Routes>
  );
}

export default App;
