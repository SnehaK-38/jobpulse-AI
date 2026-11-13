import API from "./api";

const auth = () => ({ headers: { Authorization: "Bearer " + localStorage.getItem("token") } });

export const getCareerDevelopment = async () => {
  const response = await API.get("/career-development", auth());
  return response.data;
};

export const saveCareerPreferences = async (interests, selectedRole) => {
  const response = await API.put("/career-development/preferences", { interests, selectedRole }, auth());
  return response.data;
};

export const createLearningRoadmap = async (role) => {
  const response = await API.post("/career-development/roadmap", { role }, auth());
  return response.data;
};

export const updateLearningStatus = async (itemId, status) => {
  const response = await API.patch("/career-development/roadmap/" + itemId + "/status", { status }, auth());
  return response.data;
};

export const getGeminiInterestOptions = async () => {
  const response = await API.get("/career-development/ai/interests", auth());
  return response.data;
};

export const generateGeminiCareerRecommendations = async (interests) => {
  const response = await API.post("/career-development/ai/recommendations", { interests }, auth());
  return response.data;
};

export const createGeminiLearningRoadmap = async (role) => {
  const response = await API.post("/career-development/ai/roadmap", { role }, auth());
  return response.data;
};
