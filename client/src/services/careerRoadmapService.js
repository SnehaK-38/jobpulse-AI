import API from "./api";

const authConfig = () => ({ headers: { Authorization: "Bearer " + localStorage.getItem("token") } });

export const getCareerRoadmap = async () => {
  const response = await API.get("/career-roadmap", authConfig());
  return response.data;
};

export const generateCareerRoadmap = async (missingSkills) => {
  const response = await API.post("/career-roadmap/generate", { missingSkills }, authConfig());
  return response.data;
};

export const updateCareerSkillStatus = async (skillId, status) => {
  const response = await API.patch("/career-roadmap/skills/" + skillId + "/status", { status }, authConfig());
  return response.data;
};
