export const ADMIN_ROLES = Object.freeze({
  SUPER_ADMIN: "super-admin",
  MODERATOR: "moderator",
  CONTENT_EDITOR: "content-editor",
});

export const ADMIN_ROLE_VALUES = Object.values(ADMIN_ROLES);

// Roles that retain full, unrestricted access to every admin route.
export const FULL_ACCESS_ROLES = [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.MODERATOR];
