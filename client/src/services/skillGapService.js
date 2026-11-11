import API from "./api";

export const getSkillGapOverview = async () => {
  const response = await API.get("/skill-gap/overview", {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token")}`,
    },
  });

  return response.data;
};
