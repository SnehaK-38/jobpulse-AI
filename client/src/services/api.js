import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || "";
    const isAuthenticationRequest =
      requestUrl.startsWith("/auth/login") ||
      requestUrl.startsWith("/auth/signup");

    if (error.response?.status === 401 && !isAuthenticationRequest) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("rememberMe");

      if (window.location.pathname !== "/login") {
        window.location.assign("/login?session=expired");
      }
    }

    return Promise.reject(error);
  }
);

export default API;