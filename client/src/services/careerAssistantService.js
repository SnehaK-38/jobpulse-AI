import API from "./api";

const auth = () => ({ headers: { Authorization: "Bearer " + localStorage.getItem("token") } });

export const getCareerAssistantConversation = async () => {
  const response = await API.get("/career-assistant/conversation", auth());
  return response.data;
};

export const sendCareerAssistantMessage = async (message) => {
  const response = await API.post("/career-assistant/chat", { message }, auth());
  return response.data;
};

export const clearCareerAssistantConversation = async () => {
  const response = await API.delete("/career-assistant/conversation", auth());
  return response.data;
};
