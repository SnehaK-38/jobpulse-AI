import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

import {
  FaArrowLeft,
  FaSave,
  FaTimes,
  FaPlus,
} from "react-icons/fa";

import ResumeSection from "../../components/Profile/ResumeSection";
import SkillsSection from "../../components/Profile/SkillsSection";
import EducationSection from "../../components/Profile/EducationSection";
import ProjectsSection from "../../components/Profile/ProjectsSection";
import ExperienceSection from "../../components/Profile/ExperienceSection";
import CertificationsSection from "../../components/Profile/CertificationsSection";
import SocialLinksSection from "../../components/Profile/SocialLinksSection";

import Notification from "../../components/Notification/Notification";

import {
  getProfile,
  updateProfile,
  uploadProfilePhoto,
  removeProfilePhoto,
} from "../../services/profileService";

import {
  uploadResume,
  deleteResume,
  parseResume,
} from "../../services/resumeService";

import "./CareerProfile.css";
import ProfileSidebar from "../../components/ProfileSidebar/ProfileSidebar";

function CareerProfile() {
  const navigate = useNavigate();

  const fileInputRef = useRef(null);

  // ============================================
  // BASIC STATES
  // ============================================

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [activeSection, setActiveSection] = useState("personal");

  // ============================================
  // RESUME STATES
  // ============================================

  const [resumeText, setResumeText] = useState("");
  const [parsingResume, setParsingResume] = useState(false);

  const [pendingResume, setPendingResume] = useState(null);
  const [resumeDeletePending, setResumeDeletePending] =
    useState(false);

  // ============================================
  // NOTIFICATION
  // ============================================

  const [notification, setNotification] = useState({
    message: "",
    type: "success",
  });

  // ============================================
  // SKILL MODAL
  // ============================================

  const [showSkillModal, setShowSkillModal] =
    useState(false);

  const [newSkill, setNewSkill] = useState("");

  // ============================================
  // PROFILE STATE
  // ============================================

  const [profile, setProfile] = useState({
    fullName: "",
    email: "",

    phone: "",
    bio: "",

    resume: "",
    resumeOriginalName: "",
    resumeSize: 0,

    targetRole: "",
    lookingFor: "",
    preferredLocation: "",
    preferredWorkMode: "",

    github: "",
    linkedin: "",
    portfolio: "",

    skills: [],
    education: [],
    projects: [],
    experience: [],
    yearsOfExperience: "",
    certifications: [],

    achievements: [],
    languagesKnown: [],

    socialLinks: [],
  });

  // ============================================
  // LOAD PROFILE
  // ============================================

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const data = await getProfile();

      setProfile({
        ...data.user,

        skills: data.user.skills || [],
        education: data.user.education || [],
        projects: data.user.projects || [],
        experience: data.user.experience || [],
        certifications:
          data.user.certifications || [],
        achievements:
          data.user.achievements || [],
        languagesKnown:
          data.user.languagesKnown || [],
        socialLinks:
          data.user.socialLinks || [],
      });
    } catch (error) {
      console.error(
        "LOAD PROFILE ERROR:",
        error
      );

      showNotification(
        error.message ||
          "Unable to load profile.",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // NOTIFICATION HELPER
  // ============================================

  const showNotification = (
    message,
    type = "success"
  ) => {
    setNotification({
      message,
      type,
    });

    setTimeout(() => {
      setNotification({
        message: "",
        type: "success",
      });
    }, 3000);
  };

  // ============================================
  // GENERAL INPUT CHANGE
  // ============================================

  const handleChange = (e) => {
    const { name, value } = e.target;

    setProfile((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // ============================================
  // PROFILE PHOTO UPLOAD
  // ============================================

  const handlePhotoUpload = async (e) => {
    const file = e.target?.files?.[0];

    if (!file) return;

    try {
      const response =
        await uploadProfilePhoto(file);

      setProfile(response.user);

      showNotification(
        "Profile photo updated successfully!",
        "success"
      );
    } catch (error) {
      console.error(
        "PHOTO UPLOAD ERROR:",
        error
      );

      showNotification(
        error.message ||
          "Failed to upload profile photo.",
        "error"
      );
    }
  };

  // ============================================
  // REMOVE PROFILE PHOTO
  // ============================================

  const handleRemovePhoto = async () => {
    try {
      const response =
        await removeProfilePhoto();

      setProfile(response.user);

      showNotification(
        "Profile photo removed successfully.",
        "success"
      );
    } catch (error) {
      console.error(
        "REMOVE PHOTO ERROR:",
        error
      );

      showNotification(
        error.message ||
          "Failed to remove profile photo.",
        "error"
      );
    }
  };

  // ============================================
  // RESUME UPLOAD
  // ============================================

  const handleResumeUpload = (e) => {
    if (!e) {
      console.error(
        "Resume event is missing."
      );
      return;
    }

    const file =
      e.target?.files?.[0];

    if (!file) return;

    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedTypes.includes(file.type)) {
      showNotification(
        "Only PDF, DOC and DOCX files are allowed.",
        "error"
      );

      e.target.value = "";
      return;
    }

    // Store temporarily.
    // Actual upload happens ONLY after Save Changes.
    setPendingResume(file);

    // Cancel pending deletion.
    setResumeDeletePending(false);

    // Show selected file immediately.
    setProfile((prev) => ({
      ...prev,
      resumeOriginalName: file.name,
      resumeSize: file.size,
    }));

    showNotification(
      "Resume selected. Click Save Changes to upload it.",
      "success"
    );
  };

  // ============================================
  // PARSE / ANALYZE RESUME
  // ============================================

  const handleParseResume = async () => {
    if (!profile.resume) {
      showNotification(
        "Please save your uploaded resume first.",
        "error"
      );

      return;
    }

    try {
      setParsingResume(true);

      const data = await parseResume();

      setResumeText(data.text || "");

      // Store extracted information locally.
      // It will be saved when Save Changes is clicked.
      setProfile((prev) => ({
        ...prev,

        skills: data.skills || [],
        education: data.education || [],
        projects: data.projects || [],
        experience: data.experience || [],
        certifications:
          data.certifications || [],
        achievements:
          data.achievements || [],
        socialLinks:
          data.socialLinks || [],
      }));

      showNotification(
        "Resume analyzed successfully! Extracted information is ready to review.",
        "success"
      );
    } catch (error) {
      console.error(
        "Resume analysis error:",
        error
      );

      showNotification(
        error.message ||
          "Failed to analyze resume.",
        "error"
      );
    } finally {
      setParsingResume(false);
    }
  };

  // ============================================
  // DELETE RESUME
  // ============================================

  const handleDeleteResume = () => {
    setPendingResume(null);

    setResumeDeletePending(true);

    setProfile((prev) => ({
      ...prev,

      resume: "",
      resumeOriginalName: "",
      resumeSize: 0,
    }));

    showNotification(
      "Resume removal selected. Click Save Changes to confirm.",
      "success"
    );
  };

  // ============================================
  // ADD SKILL
  // ============================================

  const openSkillModal = () => {
    setNewSkill("");
    setShowSkillModal(true);
  };

  const closeSkillModal = () => {
    setNewSkill("");
    setShowSkillModal(false);
  };

  const handleAddSkill = () => {
    const skill = newSkill.trim();

    if (!skill) {
      showNotification(
        "Please enter a skill.",
        "error"
      );

      return;
    }

    const currentSkills =
      profile.skills || [];

    // Prevent duplicates.
    const alreadyExists =
      currentSkills.some(
        (existingSkill) =>
          existingSkill.toLowerCase() ===
          skill.toLowerCase()
      );

    if (alreadyExists) {
      showNotification(
        "This skill already exists.",
        "error"
      );

      return;
    }

    setProfile((prev) => ({
      ...prev,

      skills: [
        ...(prev.skills || []),
        skill,
      ],
    }));

    setNewSkill("");

    setShowSkillModal(false);

    showNotification(
      `"${skill}" added. Click Save Changes to save it.`,
      "success"
    );
  };

  // ============================================
  // SAVE EVERYTHING
  // ============================================

  const handleSave = async () => {
    // ============================================
    // BIO VALIDATION
    // ============================================

    const bio =
      profile.bio?.trim() || "";

    if (
      bio.length > 0 &&
      bio.length < 10
    ) {
      showNotification(
        "Bio must contain at least 10 characters.",
        "error"
      );

      setActiveSection("personal");

      return;
    }

    if (bio.length > 500) {
      showNotification(
        "Bio cannot exceed 500 characters.",
        "error"
      );

      setActiveSection("personal");

      return;
    }

    if (
      bio.length > 0 &&
      !/[A-Za-z]/.test(bio)
    ) {
      showNotification(
        "Bio must contain at least one letter.",
        "error"
      );

      setActiveSection("personal");

      return;
    }

    try {
      setSaving(true);

      let savedProfile = {
        ...profile,
      };

      // ============================================
      // STEP 1
      // UPLOAD NEW RESUME
      // ============================================

      if (pendingResume) {
        const response =
          await uploadResume(
            pendingResume
          );

        if (!response.success) {
          throw new Error(
            response.message ||
              "Resume upload failed."
          );
        }

        savedProfile = {
          ...savedProfile,
          ...response.user,
        };
      }

      // ============================================
      // STEP 2
      // DELETE RESUME
      // ============================================

      if (
        resumeDeletePending &&
        !pendingResume
      ) {
        const response =
          await deleteResume();

        if (!response.success) {
          throw new Error(
            response.message ||
              "Resume deletion failed."
          );
        }

        savedProfile = {
          ...savedProfile,
          ...response.user,
        };
      }

      // ============================================
      // STEP 3
      // SAVE ALL PROFILE DATA
      // ============================================

      const response =
        await updateProfile(
          savedProfile
        );

      if (!response.success) {
        throw new Error(
          response.message ||
            "Profile update failed."
        );
      }

      // ============================================
      // STEP 4
      // UPDATE FRONTEND STATE
      // ============================================

      setProfile({
        ...response.user,

        skills:
          response.user.skills || [],

        education:
          response.user.education || [],

        projects:
          response.user.projects || [],

        experience:
          response.user.experience || [],

        certifications:
          response.user.certifications ||
          [],

        achievements:
          response.user.achievements ||
          [],

        languagesKnown:
          response.user.languagesKnown ||
          [],

        socialLinks:
          response.user.socialLinks ||
          [],
      });

      setPendingResume(null);

      setResumeDeletePending(false);

      showNotification(
        "Profile saved successfully!",
        "success"
      );
    } catch (error) {
      console.error(
        "SAVE PROFILE ERROR:",
        error
      );

      showNotification(
        error.message ||
          "Failed to save profile.",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // PROFILE COMPLETION
  // ============================================

  const calculateCompletion = () => {
    const fields = [
      profile.fullName,
      profile.email,

      profile.phone,
      profile.bio,

      profile.resume || pendingResume,

      profile.skills,
      profile.education,
      profile.projects,
      profile.experience,
      profile.certifications,

      profile.github,
      profile.linkedin,
      profile.portfolio,
    ];

    const completed =
      fields.filter((field) => {
        if (Array.isArray(field)) {
          return field.length > 0;
        }

        return (
          field !== null &&
          field !== undefined &&
          field.toString().trim() !== ""
        );
      }).length;

    return Math.round(
      (completed / fields.length) *
        100
    );
  };

  // ============================================
  // LOADING
  // ============================================

  if (loading) {
    return (
      <div className="loading">
        Loading Profile...
      </div>
    );
  }

  // ============================================
  // UI
  // ============================================

  return (
    <div className="profile-page">

      {/* ======================================
          NOTIFICATION
      ======================================= */}

      <Notification
        message={notification.message}
        type={notification.type}
        onClose={() =>
          setNotification({
            message: "",
            type: "success",
          })
        }
      />

      {/* ======================================
          SKILL MODAL
      ======================================= */}

      {showSkillModal && (
        <div className="skill-modal-overlay">

          <div className="skill-modal">

            <div className="skill-modal-header">

              <h2>Add Skill</h2>

              <button
                type="button"
                className="skill-modal-close"
                onClick={closeSkillModal}
              >
                <FaTimes />
              </button>

            </div>

            <p>
              Add a skill manually to your
              profile.
            </p>

            <input
              type="text"
              value={newSkill}
              onChange={(e) =>
                setNewSkill(
                  e.target.value
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAddSkill();
                }
              }}
              placeholder="e.g. Python"
              autoFocus
            />

            <div className="skill-modal-actions">

              <button
                type="button"
                className="skill-cancel-btn"
                onClick={closeSkillModal}
              >
                Cancel
              </button>

              <button
                type="button"
                className="skill-add-btn"
                onClick={handleAddSkill}
              >
                <FaPlus />
                Add Skill
              </button>

            </div>

          </div>

        </div>
      )}

      {/* ======================================
          SIDEBAR
      ======================================= */}

      <ProfileSidebar
        profile={profile}
        completion={calculateCompletion()}
        fileInputRef={fileInputRef}
        handlePhotoUpload={
          handlePhotoUpload
        }
        handleRemovePhoto={
          handleRemovePhoto
        }
        activeSection={
          activeSection
        }
        setActiveSection={
          setActiveSection
        }
      />

      {/* ======================================
          MAIN CONTENT
      ======================================= */}

      <div className="profile-content">

        {/* ====================================
            TOP BAR
        ===================================== */}

        <div className="profile-topbar">

          <button
            className="home-btn"
            onClick={() =>
              navigate("/")
            }
          >
            <FaArrowLeft />
            Home
          </button>

          <button
            className="save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            <FaSave />

            {saving
              ? "Saving..."
              : "Save Changes"}
          </button>

        </div>

        {/* ====================================
            WELCOME
        ===================================== */}

        <div className="welcome-card">

          <h1>
            Welcome Back 👋
          </h1>

          <p>
            Complete your JobPulse AI
            profile to unlock smarter
            job recommendations and
            AI-powered career insights.
          </p>

        </div>

        {/* ====================================
            PERSONAL INFORMATION
        ===================================== */}

        {activeSection ===
          "personal" && (
          <>
            <div className="card-grid">

              <div className="card">

                <h2>
                  Personal Information
                </h2>

                <input
                  type="text"
                  name="phone"
                  placeholder="Phone Number"
                  value={
                    profile.phone || ""
                  }
                  onChange={
                    handleChange
                  }
                />

                <textarea
                  name="bio"
                  placeholder="Tell recruiters about yourself..."
                  value={
                    profile.bio || ""
                  }
                  onChange={
                    handleChange
                  }
                  maxLength={500}
                />

              </div>

              <div className="card">

                <h2>
                  Career Preferences
                </h2>

                <input
                  type="text"
                  name="targetRole"
                  placeholder="Target Role"
                  value={
                    profile.targetRole ||
                    ""
                  }
                  onChange={
                    handleChange
                  }
                />

                <select
                  name="lookingFor"
                  value={
                    profile.lookingFor ||
                    ""
                  }
                  onChange={
                    handleChange
                  }
                >
                  <option value="">
                    Looking For
                  </option>

                  <option>
                    Internship
                  </option>

                  <option>
                    Full-Time
                  </option>

                  <option>
                    Both
                  </option>
                </select>

                <input
                  type="text"
                  name="preferredLocation"
                  placeholder="Preferred Location"
                  value={
                    profile.preferredLocation ||
                    ""
                  }
                  onChange={
                    handleChange
                  }
                />

                <select
                  name="preferredWorkMode"
                  value={
                    profile.preferredWorkMode ||
                    ""
                  }
                  onChange={
                    handleChange
                  }
                >
                  <option value="">
                    Preferred Work Mode
                  </option>

                  <option>
                    Remote
                  </option>

                  <option>
                    Hybrid
                  </option>

                  <option>
                    On-site
                  </option>
                </select>

              </div>

            </div>

            <div className="card">

              <h2>
                Professional Profiles
              </h2>

              <input
                type="text"
                name="github"
                placeholder="GitHub URL"
                value={
                  profile.github || ""
                }
                onChange={
                  handleChange
                }
              />

              <input
                type="text"
                name="linkedin"
                placeholder="LinkedIn URL"
                value={
                  profile.linkedin || ""
                }
                onChange={
                  handleChange
                }
              />

              <input
                type="text"
                name="portfolio"
                placeholder="Portfolio Website"
                value={
                  profile.portfolio || ""
                }
                onChange={
                  handleChange
                }
              />

            </div>
          </>
        )}

        {/* ====================================
            RESUME
        ===================================== */}

        {activeSection ===
          "resume" && (
          <ResumeSection
            profile={profile}
            pendingResume={
              pendingResume
            }
            resumeDeletePending={
              resumeDeletePending
            }
            handleResumeUpload={
              handleResumeUpload
            }
            handleDeleteResume={
              handleDeleteResume
            }
            handleParseResume={
              handleParseResume
            }
            parsingResume={
              parsingResume
            }
          />
        )}

        {/* ====================================
            SKILLS
        ===================================== */}

        {activeSection ===
          "skills" && (
          <SkillsSection
            profile={profile}
            setProfile={setProfile}
            onAddSkill={
              openSkillModal
            }
          />
        )}

        {/* ====================================
            EDUCATION
        ===================================== */}

        {activeSection ===
          "education" && (
          <EducationSection
            profile={profile}
            setProfile={setProfile}
          />
        )}

        {/* ====================================
            PROJECTS
        ===================================== */}

        {activeSection ===
          "projects" && (
          <ProjectsSection
            projects={
              profile.projects || []
            }
            setProfile={
              setProfile
            }
          />
        )}

        {/* ====================================
            EXPERIENCE
        ===================================== */}

        {activeSection ===
          "experience" && (
          <ExperienceSection
            experience={
              profile.experience || []
            }
            yearsOfExperience={
              profile.yearsOfExperience
            }
            setProfile={
              setProfile
            }
          />
        )}

        {/* ====================================
            CERTIFICATIONS
        ===================================== */}

        {activeSection ===
          "certifications" && (
          <CertificationsSection
            certifications={
              profile.certifications ||
              []
            }
            achievements={
              profile.achievements || []
            }
            setProfile={
              setProfile
            }
          />
        )}

        {activeSection === "social" && 
        ( <SocialLinksSection profile={profile} 
        handleChange={handleChange} 
        /> 
        )}

      </div>
    </div>
  );
}

export default CareerProfile;
