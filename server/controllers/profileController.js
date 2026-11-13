const User = require("../models/User");
const sanitizeHtml = require("sanitize-html");
// ============================
// Get Logged-in User Profile
// ============================

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ============================
// Update Profile
// ============================

exports.updateProfile = async (req, res) => {
  try {

    const userId = req.user.id;

    const {
      phone,
      bio,
      targetRole,
      lookingFor,
      preferredLocation,
      preferredWorkMode,
      expectedSalary,
      preferredIndustry,
      preferredCompanies,
      github,
      linkedin,
      portfolio,
    } = req.body;

    const yearsOfExperience =
      req.body.yearsOfExperience === undefined
        ? undefined
        : req.body.yearsOfExperience === null ||
            req.body.yearsOfExperience === ""
          ? null
          : Number(req.body.yearsOfExperience);

    if (
      yearsOfExperience !== undefined &&
      yearsOfExperience !== null &&
      (!Number.isFinite(yearsOfExperience) ||
        yearsOfExperience < 0 ||
        yearsOfExperience > 80)
    ) {
      return res.status(400).json({
        success: false,
        message: "Years of experience must be between 0 and 80.",
      });
    }

    // ============================
    // Bio Validation
    // ============================

    if (bio !== undefined) {
      if (typeof bio !== "string") {
        return res.status(400).json({
          success: false,
          message: "Bio must be text",
        });
      }

      if (bio.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: "Bio must contain at least 10 characters",
        });
      }

      if (bio.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Bio cannot exceed 500 characters",
        });
      }

      if (!/[A-Za-z]/.test(bio)) {
        return res.status(400).json({
          success: false,
          message: "Bio must contain at least one letter",
        });
      }
    }
    // ============================
// Bio Sanitization
// ============================

let sanitizedBio = bio;

if (bio !== undefined) {
  sanitizedBio = sanitizeHtml(bio, {
    allowedTags: [],
    allowedAttributes: {},
  });
}
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        phone,
        bio: sanitizedBio,
        targetRole,
        lookingFor,
        preferredLocation,
        preferredWorkMode,
        expectedSalary,
        preferredIndustry,
        preferredCompanies: preferredCompanies || [],
        github,
        linkedin,
        portfolio,
        skills: req.body.skills || [],
        resumeSkills: req.body.resumeSkills || [],
        education: req.body.education || [],
        projects: req.body.projects || [],
        experience: req.body.experience || [],
        yearsOfExperience,
        certifications: req.body.certifications || [],
        achievements: req.body.achievements || [],
        languagesKnown: req.body.languagesKnown || [],
        socialLinks: req.body.socialLinks || [],
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    res.status(200).json({
      success: true,
      message: "Profile Updated Successfully",
      user: updatedUser,
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
exports.removeProfilePhoto = async (req, res) => {

  try {

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        profilePhoto: "",
      },
      {
        new: true,
      }
    ).select("-password");

    res.status(200).json({
      success: true,
      user,
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message,
    });

  }

};
