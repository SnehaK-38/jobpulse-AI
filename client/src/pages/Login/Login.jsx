import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import API from "../../services/api";
import "./Login.css";

function Login() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // =========================
  // LOGIN FORM
  // =========================

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // =========================
  // FORGOT PASSWORD
  // =========================

  const [showForgotPassword, setShowForgotPassword] =
    useState(false);

  const [forgotEmail, setForgotEmail] = useState("");

  const [forgotLoading, setForgotLoading] =
    useState(false);

  const [forgotMessage, setForgotMessage] =
    useState("");

  const [forgotError, setForgotError] =
    useState("");

  // =========================
  // RESET PASSWORD
  // =========================

  const [showResetPassword, setShowResetPassword] =
    useState(false);

  const [resetToken, setResetToken] =
    useState("");

  const [newPassword, setNewPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [showNewPassword, setShowNewPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [resetLoading, setResetLoading] =
    useState(false);

  const [resetMessage, setResetMessage] =
    useState("");

  const [resetError, setResetError] =
    useState("");


  // =====================================================
  // CHECK RESET TOKEN FROM EMAIL LINK
  // =====================================================

  useEffect(() => {
    const token = searchParams.get("resetToken");

    if (token) {
      setResetToken(token);
      setShowResetPassword(true);
    }

    if (searchParams.get("session") === "expired") {
      setError("Your session expired. Please sign in again.");
    }
  }, [searchParams]);


  // =====================================================
  // LOGIN INPUT CHANGE
  // =====================================================

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });

    setError("");
  };


  // =====================================================
  // LOGIN
  // =====================================================

  const handleLogin = async () => {
    setError("");

    if (
      !formData.email.trim() ||
      !formData.password.trim()
    ) {
      setError(
        "Please enter your email and password."
      );

      return;
    }

    try {
      setLoading(true);

      const response = await API.post(
        "/auth/login",
        {
          email: formData.email,
          password: formData.password,
        }
      );

      // Save JWT Token
      localStorage.setItem(
        "token",
        response.data.token
      );

      // Save User Details
      localStorage.setItem(
        "user",
        JSON.stringify(response.data.user)
      );

      // Save Remember Me as an explicit string so the app can
      // correctly distinguish between the user's choice and a truthy
      // non-empty string value from localStorage.
      localStorage.setItem(
        "rememberMe",
        String(rememberMe)
      );

      // Redirect to Home
      navigate("/profile");

    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Invalid email or password."
      );

    } finally {
      setLoading(false);
    }
  };


  // =====================================================
  // OPEN FORGOT PASSWORD MODAL
  // =====================================================

  const openForgotPassword = () => {
    setForgotEmail(formData.email);

    setForgotMessage("");
    setForgotError("");

    setShowForgotPassword(true);
  };


  // =====================================================
  // CLOSE FORGOT PASSWORD MODAL
  // =====================================================

  const closeForgotPassword = () => {
    setShowForgotPassword(false);

    setForgotEmail("");
    setForgotMessage("");
    setForgotError("");
  };


  // =====================================================
  // FORGOT PASSWORD
  // =====================================================

  const handleForgotPassword = async () => {
    setForgotError("");
    setForgotMessage("");

    if (!forgotEmail.trim()) {
      setForgotError(
        "Please enter your email address."
      );

      return;
    }

    try {
      setForgotLoading(true);

      const response = await API.post(
        "/auth/forgot-password",
        {
          email: forgotEmail,
        }
      );

      setForgotMessage(
        response.data.message ||
        "If an account exists with this email, a reset link has been sent."
      );

    } catch (err) {
      setForgotError(
        err.response?.data?.message ||
        "Unable to send reset link. Please try again."
      );

    } finally {
      setForgotLoading(false);
    }
  };


  // =====================================================
  // CLOSE RESET PASSWORD MODAL
  // =====================================================

  const closeResetPassword = () => {
    setShowResetPassword(false);

    setResetToken("");

    setNewPassword("");
    setConfirmPassword("");

    setResetMessage("");
    setResetError("");

    // Remove token from URL
    setSearchParams({});
  };


  // =====================================================
  // RESET PASSWORD
  // =====================================================

  // =====================================================
// RESET PASSWORD
// =====================================================

const handleResetPassword = async () => {
  setResetError("");
  setResetMessage("");

  // ==========================================
  // 1. PASSWORD REQUIRED
  // ==========================================

  if (!newPassword.trim()) {
    setResetError("Please enter your new password.");
    return;
  }

  // ==========================================
  // 2. CONFIRM PASSWORD REQUIRED
  // ==========================================

  if (!confirmPassword.trim()) {
    setResetError("Please confirm your new password.");
    return;
  }

  // ==========================================
  // 3. PASSWORD LENGTH
  // ==========================================

  if (newPassword.length < 8) {
    setResetError(
      "Password must be at least 8 characters."
    );
    return;
  }

  // ==========================================
  // 4. PASSWORD - UPPERCASE
  // ==========================================

  if (!/[A-Z]/.test(newPassword)) {
    setResetError(
      "Password must contain at least one uppercase letter."
    );
    return;
  }

  // ==========================================
  // 5. PASSWORD - LOWERCASE
  // ==========================================

  if (!/[a-z]/.test(newPassword)) {
    setResetError(
      "Password must contain at least one lowercase letter."
    );
    return;
  }

  // ==========================================
  // 6. PASSWORD - NUMBER
  // ==========================================

  if (!/[0-9]/.test(newPassword)) {
    setResetError(
      "Password must contain at least one number."
    );
    return;
  }

  // ==========================================
  // 7. PASSWORD - SPECIAL CHARACTER
  // ==========================================

  if (!/[!@#$%^&*]/.test(newPassword)) {
    setResetError(
      "Password must contain at least one special character (!@#$%^&*)."
    );
    return;
  }

  // ==========================================
  // 8. CONFIRM PASSWORD
  // ==========================================

  if (newPassword !== confirmPassword) {
    setResetError(
      "Passwords do not match."
    );
    return;
  }

  // ==========================================
  // 9. RESET TOKEN
  // ==========================================

  if (!resetToken) {
    setResetError(
      "Invalid or missing reset token."
    );
    return;
  }

  // ==========================================
  // 10. RESET PASSWORD API
  // ==========================================

  try {
    setResetLoading(true);

    const response = await API.post(
      `/auth/reset-password/${resetToken}`,
      {
        password: newPassword,
        confirmPassword: confirmPassword,
      }
    );

    // ==========================================
    // SUCCESS
    // ==========================================

    setResetMessage(
      response.data.message ||
      "Password reset successfully."
    );

    // Clear password fields
    setNewPassword("");
    setConfirmPassword("");

    // Close modal after 2 seconds
    setTimeout(() => {
      closeResetPassword();
    }, 2000);

  } catch (err) {

    setResetError(
      err.response?.data?.message ||
      "Unable to reset password. Please try again."
    );

  } finally {

    setResetLoading(false);

  }
};

  // =====================================================
  // JSX
  // =====================================================

  return (
    <div className="login-container">

      {/* ========================= */}
      {/* LOGIN CARD */}
      {/* ========================= */}

      <div className="login-card">

        {/* BACK BUTTON */}

        <button
          className="back-btn"
          onClick={() => navigate("/")}
        >
          ← Back to Home
        </button>


        {/* TITLE */}

        <h1>
          Welcome Back 👋
        </h1>

        <p className="subtitle">
          Login to continue your JobPulse AI journey
        </p>


        {/* EMAIL */}

        <input
          type="email"
          name="email"
          placeholder="Email Address"
          value={formData.email}
          onChange={handleChange}
        />


        {/* PASSWORD */}

        <div className="password-box">

          <input
            type={
              showPassword
                ? "text"
                : "password"
            }
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleChange}
          />

          <button
            type="button"
            className="show-btn"
            onClick={() =>
              setShowPassword(
                !showPassword
              )
            }
          >
            {showPassword
              ? "Hide"
              : "Show"}
          </button>

        </div>


        {/* LOGIN OPTIONS */}

        <div className="login-options">

          <label className="remember">

            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) =>
                setRememberMe(
                  e.target.checked
                )
              }
            />

            Remember Me

          </label>


          {/* FORGOT PASSWORD */}

          <button
            type="button"
            className="forgot"
            onClick={
              openForgotPassword
            }
          >
            Forgot Password?
          </button>

        </div>


        {/* LOGIN ERROR */}

        {error && (
          <p className="error-message">
            {error}
          </p>
        )}


        {/* LOGIN BUTTON */}

        <button
          className="login-btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading
            ? "Logging In..."
            : "Login"}
        </button>


        {/* SIGNUP */}

        <div className="signup-link">

          Don't have an account?

          <span
            onClick={() =>
              navigate("/signup")
            }
          >
            Sign Up
          </span>

        </div>

      </div>


      {/* ================================================= */}
      {/* FORGOT PASSWORD MODAL */}
      {/* ================================================= */}

      {showForgotPassword && (

        <div
          className="modal-overlay"
          onClick={closeForgotPassword}
        >

          <div
            className="password-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            {/* CLOSE */}

            <button
              className="modal-close"
              onClick={
                closeForgotPassword
              }
            >
              ×
            </button>


            {/* ICON */}

            <div className="modal-icon">
              🔐
            </div>


            {/* TITLE */}

            <h2>
              Forgot Password?
            </h2>


            <p>
              Enter your registered email
              address and we'll send you
              a password reset link.
            </p>


            {/* EMAIL */}

            <input
              type="email"
              className="modal-input"
              placeholder="Email Address"
              value={forgotEmail}
              onChange={(e) => {
                setForgotEmail(
                  e.target.value
                );

                setForgotError("");
                setForgotMessage("");
              }}
            />


            {/* ERROR */}

            {forgotError && (

              <p className="modal-error">
                {forgotError}
              </p>

            )}


            {/* SUCCESS */}

            {forgotMessage && (

              <p className="modal-success">
                {forgotMessage}
              </p>

            )}


            {/* SEND BUTTON */}

            <button
              className="modal-submit"
              onClick={
                handleForgotPassword
              }
              disabled={forgotLoading}
            >
              {forgotLoading
                ? "Sending..."
                : "Send Reset Link"}
            </button>


            {/* BACK */}

            <button
              className="modal-back"
              onClick={
                closeForgotPassword
              }
            >
              Back to Login
            </button>

          </div>

        </div>

      )}


      {/* ================================================= */}
      {/* RESET PASSWORD MODAL */}
      {/* ================================================= */}

      {showResetPassword && (

        <div
          className="modal-overlay"
          onClick={closeResetPassword}
        >

          <div
            className="password-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            {/* CLOSE */}

            <button
              className="modal-close"
              onClick={
                closeResetPassword
              }
            >
              ×
            </button>


            {/* ICON */}

            <div className="modal-icon">
              🔑
            </div>


            {/* TITLE */}

            <h2>
              Reset Password
            </h2>


            <p>
              Create a new password for
              your JobPulse AI account.
            </p>


            {/* NEW PASSWORD */}

            <div className="modal-password-box">

              <input
                type={
                  showNewPassword
                    ? "text"
                    : "password"
                }
                className="modal-input"
                placeholder="New Password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(
                    e.target.value
                  );

                  setResetError("");
                }}
              />

              <button
                type="button"
                className="modal-show-btn"
                onClick={() =>
                  setShowNewPassword(
                    !showNewPassword
                  )
                }
              >
                {showNewPassword
                  ? "Hide"
                  : "Show"}
              </button>

            </div>


            {/* CONFIRM PASSWORD */}

            <div className="modal-password-box">

              <input
                type={
                  showConfirmPassword
                    ? "text"
                    : "password"
                }
                className="modal-input"
                placeholder="Confirm Password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(
                    e.target.value
                  );

                  setResetError("");
                }}
              />

              <button
                type="button"
                className="modal-show-btn"
                onClick={() =>
                  setShowConfirmPassword(
                    !showConfirmPassword
                  )
                }
              >
                {showConfirmPassword
                  ? "Hide"
                  : "Show"}
              </button>

            </div>


            {/* ERROR */}

            {resetError && (

              <p className="modal-error">
                {resetError}
              </p>

            )}


            {/* SUCCESS */}

            {resetMessage && (

              <p className="modal-success">
                {resetMessage}
              </p>

            )}


            {/* RESET BUTTON */}

            <button
              className="modal-submit"
              onClick={
                handleResetPassword
              }
              disabled={resetLoading}
            >
              {resetLoading
                ? "Resetting..."
                : "Reset Password"}
            </button>


            {/* BACK */}

            <button
              className="modal-back"
              onClick={
                closeResetPassword
              }
            >
              Back to Login
            </button>

          </div>

        </div>

      )}

    </div>
  );
}

export default Login;