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
  return { ...response.data, jobIds };
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
