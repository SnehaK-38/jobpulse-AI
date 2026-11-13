import "./Navbar.css";
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { ChevronDown, LayoutDashboard, LogOut, Settings, UserRound, Target, Bookmark, Compass, Bot, Sun, Moon } from "lucide-react";
import { getProfile } from "../../services/profileService";

function Navbar({ dashboardMode = false }) {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [profile, setProfile] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("jobpulse-theme") || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("jobpulse-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === "light" ? "dark" : "light");
  const user = JSON.parse(localStorage.getItem("user"));

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await getProfile();
        setProfile(data.user);
      } catch (err) {
        console.log(err);
      }
    };
    if (localStorage.getItem("token")) fetchProfile();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("rememberMe");
    navigate("/");
    window.location.reload();
  };

  const displayName = profile?.fullName || user?.fullName || "My account";
  const initials = displayName.charAt(0).toUpperCase();
  const profilePhoto = profile?.profilePhoto ? `http://localhost:5000${profile.profilePhoto}` : "";

  return (
    <nav className={`navbar${dashboardMode ? " dashboard-navbar" : ""}`}>
      <Link className="logo" to={dashboardMode ? "/dashboard" : "/"}>
        <span className="logo-icon">JP</span>
        <span className="logo-text"><span>JobPulse</span><small>AI CAREER MATCHING</small></span>
      </Link>

      <ul className="nav-links">\n        <li><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}<span>{theme === "light" ? "Dark" : "Light"} mode</span></button></li>
        {!dashboardMode && (
          <>
            <li><a href="#features">Features</a></li>
            <li><a href="#how-it-works">How It Works</a></li>
            <li><a href="#about">About</a></li>
            {!user && (
              <>
                <li><Link to="/login">Login</Link></li>
                <li><Link to="/signup" className="signup-btn">Sign Up</Link></li>
              </>
            )}
          </>
        )}

        {user && dashboardMode && (
          <>
            <li><Link to="/saved-jobs" className="saved-jobs-nav-link"><Bookmark size={16} /> Saved Jobs</Link></li>
            <li><Link to="/skill-gap" className="skill-gap-nav-link"><Target size={16} /> Skill Gap Analysis</Link></li>
            <li><Link to="/career-development" className="career-development-nav-link"><Compass size={16} /> Career Navigator</Link></li>
            <li><Link to="/career-assistant" className="career-assistant-nav-link"><Bot size={16} /> AI Assistant</Link></li>
          </>
        )}

        {user && (
          <li className="profile-menu">
            <button className="profile-btn" type="button" aria-expanded={showMenu} aria-haspopup="menu" onClick={() => setShowMenu((open) => !open)}>
              <span className="avatar">{profilePhoto ? <img src={profilePhoto} alt="" /> : initials}</span>
              <span className="user-name">{displayName.split(" ")[0]}</span>
              <ChevronDown className="profile-chevron" size={15} />
            </button>

            {showMenu && (
              <div className="dropdown" role="menu">
                <div className="user-info">
                  <span className="user-avatar">{profilePhoto ? <img src={profilePhoto} alt="" /> : initials}</span>
                  <h4>{displayName}</h4>
                  <p>{profile?.email || user.email}</p>
                </div>
                <hr />
                <Link className="dropdown-link" role="menuitem" to="/dashboard" onClick={() => setShowMenu(false)}><LayoutDashboard size={17} />Dashboard</Link>
                <button className="dropdown-link" role="menuitem" type="button" onClick={() => { setShowMenu(false); navigate("/profile"); }}><UserRound size={17} />My Profile</button>
                <button className="dropdown-link" role="menuitem" type="button"><Settings size={17} />Settings</button>
                <button className="dropdown-link logout" role="menuitem" type="button" onClick={handleLogout}><LogOut size={17} />Logout</button>
              </div>
            )}
          </li>
        )}
      </ul>
    </nav>
  );
}

export default Navbar;
