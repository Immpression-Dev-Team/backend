// routes/admin-userAuthRoutes/admin-reportRoutes.js
import express from "express";
import mongoose from "mongoose";
import Report, {
  REPORT_STATUS,
  REPORT_REASON,
  RESOLUTION_ACTION,
} from "../../models/report.js";
import UserModel from "../../models/users.js";
import ImageModel from "../../models/images.js";
import Notification, { NOTIFICATION_TYPE } from "../../models/notifications.js";
import { isAdminAuthorized } from "../../utils/authUtils.js";
import { requireRole } from "../../utils/adminAuthorization.js";
import { FULL_ACCESS_ROLES } from "../../constants/adminRoles.js";
import cloudinary from "cloudinary";

const router = express.Router();

// Reports are only accessible to full-access admins (Content Editor is excluded).
router.use(isAdminAuthorized, requireRole(FULL_ACCESS_ROLES));

// Cloudinary config
cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD,
  api_key: process.env.CLOUDINARY_API,
  api_secret: process.env.CLOUDINARY_SECRET,
});

/**
 * GET /admin/reports
 * List all reports with filtering and pagination
 */
router.get("/", isAdminAuthorized, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      reason,
      slaAtRisk,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = {};
    if (status && Object.values(REPORT_STATUS).includes(status)) {
      query.status = status;
    }
    if (reason && Object.values(REPORT_REASON).includes(reason)) {
      query.reason = reason;
    }
    if (slaAtRisk === "true") {
      const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
      query.status = { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.UNDER_REVIEW] };
      query.slaDeadline = { $lte: fourHoursFromNow };
    }

    // Build sort
    const sortField = ["createdAt", "slaDeadline", "status"].includes(sortBy)
      ? sortBy
      : "createdAt";
    const sort = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    const [reports, total] = await Promise.all([
      Report.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate("reporterUserId", "name email")
        .populate("targetUserId", "name email profilePictureLink moderationStatus")
        .populate("targetImageId", "name imageLink")
        .lean(),
      Report.countDocuments(query),
    ]);

    // Add computed fields
    const reportsWithComputed = reports.map((report) => ({
      ...report,
      slaTimeRemaining:
        report.status === REPORT_STATUS.RESOLVED ||
        report.status === REPORT_STATUS.DISMISSED
          ? null
          : Math.max(0, new Date(report.slaDeadline).getTime() - Date.now()),
      slaAtRisk:
        report.status !== REPORT_STATUS.RESOLVED &&
        report.status !== REPORT_STATUS.DISMISSED &&
        new Date(report.slaDeadline).getTime() - Date.now() < 4 * 60 * 60 * 1000,
    }));

    res.json({
      success: true,
      data: {
        reports: reportsWithComputed,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error("GET /admin/reports error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * GET /admin/reports/stats
 * Dashboard statistics for reports
 */
router.get("/stats", isAdminAuthorized, async (req, res) => {
  try {
    const now = new Date();
    const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000);

    const [
      totalPending,
      totalUnderReview,
      totalResolved,
      totalDismissed,
      atRiskCount,
      breachedCount,
      last24hCount,
      last7dCount,
    ] = await Promise.all([
      Report.countDocuments({ status: REPORT_STATUS.PENDING }),
      Report.countDocuments({ status: REPORT_STATUS.UNDER_REVIEW }),
      Report.countDocuments({ status: REPORT_STATUS.RESOLVED }),
      Report.countDocuments({ status: REPORT_STATUS.DISMISSED }),
      Report.countDocuments({
        status: { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.UNDER_REVIEW] },
        slaDeadline: { $lte: fourHoursFromNow, $gt: now },
      }),
      Report.countDocuments({ slaBreached: true }),
      Report.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
      Report.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    // Reason breakdown
    const reasonBreakdown = await Report.aggregate([
      { $match: { status: { $in: [REPORT_STATUS.PENDING, REPORT_STATUS.UNDER_REVIEW] } } },
      { $group: { _id: "$reason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        byStatus: {
          pending: totalPending,
          underReview: totalUnderReview,
          resolved: totalResolved,
          dismissed: totalDismissed,
        },
        sla: {
          atRisk: atRiskCount,
          breached: breachedCount,
        },
        activity: {
          last24Hours: last24hCount,
          last7Days: last7dCount,
        },
        byReason: reasonBreakdown,
        needsAttention: totalPending + atRiskCount,
      },
    });
  } catch (error) {
    console.error("GET /admin/reports/stats error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * GET /admin/reports/:id
 * Get single report details
 */
router.get("/:id", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid report ID" });
    }

    const report = await Report.findById(id)
      .populate("reporterUserId", "name email profilePictureLink")
      .populate("targetUserId", "name email profilePictureLink moderationStatus warningCount")
      .populate("targetImageId", "name imageLink description price category stage")
      .populate("resolvedByAdminId", "name email")
      .lean();

    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }

    // Get history of reports against this user/content
    const historyQuery = report.targetImageId
      ? { targetImageId: report.targetImageId._id, _id: { $ne: id } }
      : { targetUserId: report.targetUserId._id, _id: { $ne: id } };

    const relatedReports = await Report.find(historyQuery)
      .sort({ createdAt: -1 })
      .limit(5)
      .select("reason status createdAt resolvedAt resolutionAction")
      .lean();

    res.json({
      success: true,
      data: {
        report,
        relatedReports,
        slaTimeRemaining:
          report.status === REPORT_STATUS.RESOLVED ||
          report.status === REPORT_STATUS.DISMISSED
            ? null
            : Math.max(0, new Date(report.slaDeadline).getTime() - Date.now()),
      },
    });
  } catch (error) {
    console.error("GET /admin/reports/:id error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * PATCH /admin/reports/:id/status
 * Update report status
 */
router.patch("/:id/status", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid report ID" });
    }

    if (!status || !Object.values(REPORT_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        error: "Invalid status",
        validStatuses: Object.values(REPORT_STATUS),
      });
    }

    const updateData = { status };
    if (status === REPORT_STATUS.RESOLVED || status === REPORT_STATUS.DISMISSED) {
      updateData.resolvedAt = new Date();
      updateData.resolvedByAdminId = req.admin._id;
    }

    const report = await Report.findByIdAndUpdate(id, updateData, { new: true });

    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }

    res.json({
      success: true,
      message: `Report status updated to ${status}`,
      data: report,
    });
  } catch (error) {
    console.error("PATCH /admin/reports/:id/status error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * POST /admin/reports/:id/action/warn-user
 * Issue a warning to the reported user
 */
router.post("/:id/action/warn-user", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid report ID" });
    }

    const report = await Report.findById(id);
    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }

    if (!report.targetUserId) {
      return res.status(400).json({ success: false, error: "No target user to warn" });
    }

    // Update user moderation status
    const user = await UserModel.findByIdAndUpdate(
      report.targetUserId,
      {
        $inc: { warningCount: 1 },
        moderationStatus: "warned",
        lastModerationAction: new Date(),
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: "Target user not found" });
    }

    // Update report
    await Report.findByIdAndUpdate(id, {
      status: REPORT_STATUS.RESOLVED,
      resolvedAt: new Date(),
      resolvedByAdminId: req.admin._id,
      resolutionAction: RESOLUTION_ACTION.WARNING_ISSUED,
      resolutionNotes: message || "Warning issued for community guideline violation",
    });

    // Send notification to user
    await Notification.create({
      recipientUserId: report.targetUserId,
      type: NOTIFICATION_TYPE.MODERATION_WARNING,
      title: "Account Warning",
      message:
        message ||
        "You have received a warning for violating our community guidelines. Continued violations may result in account suspension.",
      reportId: report._id,
    });

    // Notify reporter that action was taken
    await Notification.create({
      recipientUserId: report.reporterUserId,
      type: NOTIFICATION_TYPE.REPORT_RESOLVED,
      title: "Report Resolved",
      message: "Thank you for your report. We have reviewed it and taken appropriate action.",
      reportId: report._id,
    });

    res.json({
      success: true,
      message: "Warning issued successfully",
      data: {
        userId: user._id,
        warningCount: user.warningCount,
        moderationStatus: user.moderationStatus,
      },
    });
  } catch (error) {
    console.error("POST /admin/reports/:id/action/warn-user error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * POST /admin/reports/:id/action/suspend-user
 * Temporarily suspend the reported user
 */
router.post("/:id/action/suspend-user", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { durationDays = 7, message } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid report ID" });
    }

    const report = await Report.findById(id);
    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }

    if (!report.targetUserId) {
      return res.status(400).json({ success: false, error: "No target user to suspend" });
    }

    const suspendedUntil = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    // Update user moderation status
    const user = await UserModel.findByIdAndUpdate(
      report.targetUserId,
      {
        moderationStatus: "suspended",
        suspendedUntil,
        lastModerationAction: new Date(),
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: "Target user not found" });
    }

    // Update report
    await Report.findByIdAndUpdate(id, {
      status: REPORT_STATUS.RESOLVED,
      resolvedAt: new Date(),
      resolvedByAdminId: req.admin._id,
      resolutionAction: RESOLUTION_ACTION.USER_SUSPENDED,
      resolutionNotes:
        message || `User suspended for ${durationDays} days due to community guideline violations`,
    });

    // Send notification to user
    await Notification.create({
      recipientUserId: report.targetUserId,
      type: NOTIFICATION_TYPE.MODERATION_SUSPENSION,
      title: "Account Suspended",
      message:
        message ||
        `Your account has been suspended for ${durationDays} days due to community guideline violations. You will be able to access your account again after ${suspendedUntil.toLocaleDateString()}.`,
      reportId: report._id,
    });

    // Notify reporter
    await Notification.create({
      recipientUserId: report.reporterUserId,
      type: NOTIFICATION_TYPE.REPORT_RESOLVED,
      title: "Report Resolved",
      message: "Thank you for your report. We have reviewed it and taken appropriate action.",
      reportId: report._id,
    });

    res.json({
      success: true,
      message: `User suspended for ${durationDays} days`,
      data: {
        userId: user._id,
        suspendedUntil,
        moderationStatus: user.moderationStatus,
      },
    });
  } catch (error) {
    console.error("POST /admin/reports/:id/action/suspend-user error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * POST /admin/reports/:id/action/ban-user
 * Permanently ban the reported user
 */
router.post("/:id/action/ban-user", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid report ID" });
    }

    if (!reason) {
      return res.status(400).json({ success: false, error: "Ban reason is required" });
    }

    const report = await Report.findById(id);
    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }

    if (!report.targetUserId) {
      return res.status(400).json({ success: false, error: "No target user to ban" });
    }

    // Update user moderation status
    const user = await UserModel.findByIdAndUpdate(
      report.targetUserId,
      {
        moderationStatus: "banned",
        banReason: reason,
        lastModerationAction: new Date(),
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: "Target user not found" });
    }

    // Update report
    await Report.findByIdAndUpdate(id, {
      status: REPORT_STATUS.RESOLVED,
      resolvedAt: new Date(),
      resolvedByAdminId: req.admin._id,
      resolutionAction: RESOLUTION_ACTION.USER_BANNED,
      resolutionNotes: reason,
    });

    // Send notification to user (they may still see it via email)
    await Notification.create({
      recipientUserId: report.targetUserId,
      type: NOTIFICATION_TYPE.MODERATION_BAN,
      title: "Account Terminated",
      message: `Your account has been permanently banned. Reason: ${reason}`,
      reportId: report._id,
    });

    // Notify reporter
    await Notification.create({
      recipientUserId: report.reporterUserId,
      type: NOTIFICATION_TYPE.REPORT_RESOLVED,
      title: "Report Resolved",
      message: "Thank you for your report. We have reviewed it and taken appropriate action.",
      reportId: report._id,
    });

    res.json({
      success: true,
      message: "User has been permanently banned",
      data: {
        userId: user._id,
        moderationStatus: user.moderationStatus,
        banReason: user.banReason,
      },
    });
  } catch (error) {
    console.error("POST /admin/reports/:id/action/ban-user error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * POST /admin/reports/:id/action/remove-content
 * Remove the reported content (image)
 */
router.post("/:id/action/remove-content", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { notifyUser = true, reason } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid report ID" });
    }

    const report = await Report.findById(id);
    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }

    if (!report.targetImageId) {
      return res.status(400).json({ success: false, error: "No image to remove for this report" });
    }

    // Find and delete the image
    const image = await ImageModel.findById(report.targetImageId);
    if (!image) {
      // Image may have been already deleted
      await Report.findByIdAndUpdate(id, {
        status: REPORT_STATUS.RESOLVED,
        resolvedAt: new Date(),
        resolvedByAdminId: req.admin._id,
        resolutionAction: RESOLUTION_ACTION.CONTENT_REMOVED,
        resolutionNotes: "Content was already removed",
      });

      return res.json({
        success: true,
        message: "Content was already removed",
      });
    }

    // Delete from Cloudinary
    const extractPublicId = (url) => {
      const parts = url.split("/");
      const folder = parts[parts.length - 2];
      const fileName = parts[parts.length - 1].split(".")[0];
      return `${folder}/${fileName}`;
    };

    if (image.imageLink) {
      const publicId = extractPublicId(image.imageLink);
      try {
        await cloudinary.v2.api.delete_resources([publicId], {
          type: "upload",
          resource_type: "image",
        });
      } catch (cloudError) {
        console.error("Cloudinary deletion error:", cloudError);
      }
    }

    // Delete from database
    await ImageModel.findByIdAndDelete(report.targetImageId);

    // Update report
    await Report.findByIdAndUpdate(id, {
      status: REPORT_STATUS.RESOLVED,
      resolvedAt: new Date(),
      resolvedByAdminId: req.admin._id,
      resolutionAction: RESOLUTION_ACTION.CONTENT_REMOVED,
      resolutionNotes: reason || "Content removed for violating community guidelines",
    });

    // Notify the content owner
    if (notifyUser && report.targetUserId) {
      await Notification.create({
        recipientUserId: report.targetUserId,
        type: NOTIFICATION_TYPE.CONTENT_REMOVED,
        title: "Content Removed",
        message:
          reason ||
          `Your artwork "${image.name}" has been removed for violating our community guidelines.`,
        reportId: report._id,
        data: {
          artName: image.name,
          imageLink: report.contentSnapshot?.imageLink,
        },
      });
    }

    // Notify reporter
    await Notification.create({
      recipientUserId: report.reporterUserId,
      type: NOTIFICATION_TYPE.REPORT_RESOLVED,
      title: "Report Resolved",
      message: "Thank you for your report. The content has been removed.",
      reportId: report._id,
    });

    res.json({
      success: true,
      message: "Content removed successfully",
      data: {
        removedImageId: report.targetImageId,
        imageName: image.name,
      },
    });
  } catch (error) {
    console.error("POST /admin/reports/:id/action/remove-content error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

/**
 * POST /admin/reports/:id/action/dismiss
 * Dismiss a report as unfounded
 */
router.post("/:id/action/dismiss", isAdminAuthorized, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: "Invalid report ID" });
    }

    const report = await Report.findByIdAndUpdate(
      id,
      {
        status: REPORT_STATUS.DISMISSED,
        resolvedAt: new Date(),
        resolvedByAdminId: req.admin._id,
        resolutionAction: RESOLUTION_ACTION.NO_ACTION,
        resolutionNotes: reason || "Report dismissed - no violation found",
      },
      { new: true }
    );

    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }

    // Notify reporter
    await Notification.create({
      recipientUserId: report.reporterUserId,
      type: NOTIFICATION_TYPE.REPORT_RESOLVED,
      title: "Report Reviewed",
      message:
        "We have reviewed your report. After investigation, we determined that no violation occurred. Thank you for helping keep our community safe.",
      reportId: report._id,
    });

    res.json({
      success: true,
      message: "Report dismissed",
      data: report,
    });
  } catch (error) {
    console.error("POST /admin/reports/:id/action/dismiss error:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

export default router;
