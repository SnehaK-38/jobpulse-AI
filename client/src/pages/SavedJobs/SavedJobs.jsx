import Navbar from "../../components/Navbar/Navbar";
import JobComparison from "../SkillGapAnalysis/JobComparison";
import "../SkillGapAnalysis/SkillGapAnalysis.css";

function SavedJobs() {
  return (
    <>
      <Navbar dashboardMode />
      <main className="skill-gap-page">
        <JobComparison />
      </main>
    </>
  );
}

export default SavedJobs;
