import Navbar from "../../components/Navbar/Navbar";
import JobComparison from "../SkillGapAnalysis/JobComparison";
import "../SkillGapAnalysis/SkillGapAnalysis.css";
import "./SavedJobs.css";

function SavedJobs() {
  return (
    <>
      <Navbar dashboardMode />
      <main className="skill-gap-page saved-jobs-page">
        <JobComparison />
      </main>
    </>
  );
}

export default SavedJobs;
