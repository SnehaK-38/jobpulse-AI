const mongoose = require("mongoose");

const jobRefreshStateSchema = new mongoose.Schema({
  refreshKey: { type: String, required: true, unique: true },
  lastRefreshedAt: { type: Date, required: true },
  providerSummary: { type: mongoose.Schema.Types.Mixed, default: {} },
});

module.exports = mongoose.model("JobRefreshState", jobRefreshStateSchema);
