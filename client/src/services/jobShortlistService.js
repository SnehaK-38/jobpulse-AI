import API from "./api";

const authConfig = () => ({
  headers: {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  },
});

export const getJobShortlist = async () => {
  const response = await API.get("/job-shortlist", authConfig());
  return response.data;
};

export const addJobToShortlist = async (jobId) => {
  const response = await API.post("/job-shortlist", { jobId }, authConfig());
  return response.data;
};

export const removeJobFromShortlist = async (jobId) => {
  const response = await API.delete(`/job-shortlist/${jobId}`, authConfig());
  return response.data;
};
