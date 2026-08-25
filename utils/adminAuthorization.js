import { FULL_ACCESS_ROLES } from "../constants/adminRoles.js";

// Must run after isAdminAuthorized (needs req.admin populated).
export const requireRole = (allowedRoles) => (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  if (!allowedRoles.includes(req.admin.role)) {
    return res.status(403).json({ success: false, error: "Forbidden: insufficient permissions" });
  }
  return next();
};

// Full-access roles (super-admin/moderator) always pass.
// Everyone else must be the document's creator to proceed.
// Docs with no createdBy (pre-feature legacy docs) can never match a non-full-access admin.
export const requireOwnerOrFullAccess = (Model, { field = "createdBy" } = {}) => async (req, res, next) => {
  if (!req.admin) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  if (FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return next();
  }

  try {
    const doc = await Model.findById(req.params.id).select(field);
    if (!doc) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    if (!doc[field] || String(doc[field]) !== String(req.admin._id)) {
      return res.status(403).json({
        success: false,
        error: "Forbidden: you can only edit content you created",
      });
    }
    return next();
  } catch (error) {
    console.error("Ownership check error:", error);
    return res.status(500).json({ success: false, error: "Authorization check failed" });
  }
};
