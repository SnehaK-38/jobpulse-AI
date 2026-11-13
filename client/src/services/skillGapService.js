import API from "./api";
import { getDashboardJobs } from "./dashboardService";

const auth = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
});

export const getSkillGapOverview = async () => {
  const jobResults = await getDashboardJobs({
    search_term: "",
    location: "",
    limit: 500,
  });
  const jobIds = Array.isArray(jobResults?.jobs)
    ? jobResults.jobs.map((job) => job._id).filter(Boolean)
    : [];

  const response = await API.post("/skill-gap/overview", { jobIds }, auth());
  return { ...response.data, jobIds: response.data.analysedJobIds || jobIds };
};

export const getMissingSkillsRoadmap = async () => {
  const response = await API.get("/skill-gap/roadmap", auth());
  return response.data;
};

export const generateMissingSkillsRoadmap = async (payload) => {
  const response = await API.post("/skill-gap/roadmap", payload, auth());
  return response.data;
};

export const updateMissingSkillStatus = async (itemId, status) => {
  const response = await API.patch(`/skill-gap/roadmap/${itemId}/status`, { status }, auth());
  return response.data;
};

export const generateMissingSkillsWeeklyPlan = async () => {
  const response = await API.post("/skill-gap/roadmap/weekly-plan", {}, auth());
  return response.data;
};

export const updateMissingSkillsWeeklyTask = async (weekIndex, taskIndex, completed) => {
  const response = await API.patch(`/skill-gap/roadmap/weekly-plan/${weekIndex}/${taskIndex}`, { completed }, auth());
  return response.data;
};

export const generateMissingSkillProject = async (itemId) => {
  const response = await API.post(`/skill-gap/roadmap/${itemId}/project`, {}, auth());
  return response.data;
};

export const updateMissingSkillProjectStatus = async (itemId, status) => {
  const response = await API.patch(`/skill-gap/roadmap/${itemId}/project/status`, { status }, auth());
  return response.data;
};

export const generateMissingSkillAssessment = async (itemId) => {
  const response = await API.post(`/skill-gap/roadmap/${itemId}/assessment`, {}, auth());
  return response.data;
};

export const submitMissingSkillAssessment = async (itemId, answers) => {
  const response = await API.post(`/skill-gap/roadmap/${itemId}/assessment/submit`, { answers }, auth());
  return response.data;
};
