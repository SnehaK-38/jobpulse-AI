const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // ==========================
    // Account Information (Required at Signup)
    // ==========================

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },

    acceptedTerms: {
      type: Boolean,
      required: true,
      default: false,
    },

    // ==========================
    // Profile Information (Completed After Login)
    // ==========================

    profilePhoto: {
      type: String,
      default: "",
    },

    phone: {
      type: String,
      default: "",
    },

    bio: {
      type: String,
      default: "",
    },

    // ==========================
    // Resume
    // ==========================
resumeOriginalName: {
  type: String,
  default: "",
},

resumeSize: {
  type: Number,
  default: 0,
},
    resume: {
      type: String,
      default: "",
    },

    resumeText: {
      type: String,
      default: "",
    },

    // ==========================
    // Career Preferences
    // ==========================

    targetRole: {
      type: String,
      default: "",
    },

    lookingFor: {
      type: String,
      enum: ["", "Internship", "Full-Time", "Both"],
      default: "",
    },

    preferredLocation: {
      type: String,
      default: "",
    },

    preferredWorkMode: {
      type: String,
      enum: ["", "Remote", "Hybrid", "On-site"],
      default: "",
    },

    expectedSalary: {
      type: String,
      default: "",
    },

    preferredIndustry: {
      type: String,
      default: "",
    },

    preferredCompanies: {
      type: [String],
      default: [],
    },

    // ==========================
    // Social Profiles
    // ==========================

    github: {
      type: String,
      default: "",
    },

    linkedin: {
      type: String,
      default: "",
    },

    portfolio: {
      type: String,
      default: "",
    },

    leetcode: {
      type: String,
      default: "",
    },

    codeforces: {
      type: String,
      default: "",
    },

    hackerrank: {
      type: String,
      default: "",
    },

    // ==========================
    // Professional Information
    // ==========================

    skills: {
      type: [String],
      default: [],
    },

    resumeSkills: {
      type: [String],
      default: [],
    },

    projects: {
      type: [String],
      default: [],
    },

    experience: {
      type: [String],
      default: [],
    },

    yearsOfExperience: {
      type: Number,
      min: 0,
      max: 80,
      default: null,
    },

    education: [
  {
    institution: {
      type: String,
      default: "",
    },

    degree: {
      type: String,
      default: "",
    },

    field: {
      type: String,
      default: "",
    },

    startDate: {
      type: String,
      default: "",
    },

    endDate: {
      type: String,
      default: "",
    },

    grade: {
      type: String,
      default: "",
    },
  },
],

    certifications: {
      type: [String],
      default: [],
    },

    achievements: {
      type: [String],
      default: [],
    },

    languagesKnown: {
      type: [String],
      default: [],
    },

    socialLinks: {
      type: [String],
      default: [],
    },

    // ==========================
    // Profile Completion
    // ==========================

    profileCompleted: {
      type: Boolean,
      default: false,
    },

    resetPasswordToken: {
  type: String,
  default: null,
},

resetPasswordExpire: {
  type: Date,
  default: null,
},

resetPasswordUsed: {
  type: Boolean,
  default: false,
},
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
