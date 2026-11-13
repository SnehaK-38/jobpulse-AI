import { Routes, Route } from "react-router-dom";

import Home from "./pages/Home/Home";
import Login from "./pages/Login/Login";
import Signup from "./pages/Signup/Signup";
import ResumeUpload from "./pages/ResumeUpload/ResumeUpload";
import CareerProfile from "./pages/CareerProfile/CareerProfile";
import Dashboard from "./pages/Dashboard/Dashboard";
import JobDetails from "./pages/JobDetails/JobDetails";
import SkillGapAnalysis from "./pages/SkillGapAnalysis/SkillGapAnalysis";
import SavedJobs from "./pages/SavedJobs/SavedJobs";
import CareerDevelopment from "./pages/CareerDevelopment/CareerDevelopment";
import CareerAssistant from "./pages/CareerAssistant/CareerAssistant";

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
      <Route path="/skill-gap" element={<SkillGapAnalysis />} />
      <Route path="/saved-jobs" element={<SavedJobs />} />
      <Route path="/career-development" element={<CareerDevelopment />} />
      <Route path="/career-assistant" element={<CareerAssistant />} />
    </Routes>
  );
}

export default App;
