import API from "./api";
import { getDashboardJobs } from "./dashboardService";

export const getSkillGapOverview = async () => {
  const jobResults = await getDashboardJobs({
    search_term: "",
    location: "",
    limit: 500,
  });
  const jobIds = Array.isArray(jobResults?.jobs)
    ? jobResults.jobs.map((job) => job._id).filter(Boolean)
    : [];

  const response = await API.post(
    "/skill-gap/overview",
    { jobIds },
    {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    }
  );
  return response.data;
};
