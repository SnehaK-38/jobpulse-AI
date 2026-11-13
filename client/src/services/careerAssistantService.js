import API from "./api";
const auth = () => ({ headers: { Authorization: "Bearer " + localStorage.getItem("token") } });

export const getCareerAssistantConversations = async () => (await API.get("/career-assistant/conversations", auth())).data;
export const createCareerAssistantConversation = async () => (await API.post("/career-assistant/conversations", {}, auth())).data;
export const getCareerAssistantConversation = async (id) => (await API.get(`/career-assistant/conversations/${id}`, auth())).data;
export const sendCareerAssistantMessage = async (id, message) => (await API.post(`/career-assistant/conversations/${id}/chat`, { message }, auth())).data;
export const deleteCareerAssistantConversation = async (id) => (await API.delete(`/career-assistant/conversations/${id}`, auth())).data;

export const getGeminiApiStatus = async () => (await API.get("/career-assistant/gemini-status", auth())).data;
