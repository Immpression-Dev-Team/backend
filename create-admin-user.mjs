/**
 * create-admin-user.mjs
 *
 * One-off script to provision an admin panel account (any role).
 *
 * Prerequisites:
 *   MONGO_URL must be set (via .env or shell env) — same as the main server.
 *
 * Run:
 *   node create-admin-user.mjs --email=someone@immpression.art --name="Jane Doe" --role=content-editor
 *   (omit --password to be prompted for it, so it never lands in shell history)
 *
 * Valid --role values: super-admin, moderator, content-editor
 */

import mongoose from "mongoose";
import readline from "readline";
import { MONGO_URL } from "./config/config.js";
import AdminUserModel from "./models/admin-users.js";
import { ADMIN_ROLE_VALUES } from "./constants/adminRoles.js";

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const args = parseArgs();
  const email = args.email?.trim().toLowerCase();
  const name = args.name?.trim();
  const role = args.role?.trim();
  let password = args.password;

  if (!email || !name || !role) {
    console.error(
      "\n❌  Usage: node create-admin-user.mjs --email=<email> --name=<name> --role=<role> [--password=<password>]\n" +
      `    Valid roles: ${ADMIN_ROLE_VALUES.join(", ")}\n`
    );
    process.exit(1);
  }

  if (!ADMIN_ROLE_VALUES.includes(role)) {
    console.error(`\n❌  Invalid role "${role}". Valid roles: ${ADMIN_ROLE_VALUES.join(", ")}\n`);
    process.exit(1);
  }

  if (!password) {
    console.log("(Password will not be echoed to shell history since it wasn't passed as a flag.)");
    password = await promptHidden("Password: ");
  }

  if (!password || password.length < 6) {
    console.error("\n❌  Password must be at least 6 characters.\n");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URL);

  try {
    const existing = await AdminUserModel.findOne({ email });
    if (existing) {
      console.error(`\n❌  An admin with email "${email}" already exists (id: ${existing._id}).\n`);
      process.exit(1);
    }

    const admin = await AdminUserModel.create({ email, name, password, role });
    console.log("\n✅  Admin account created:");
    console.log(`    id:    ${admin._id}`);
    console.log(`    email: ${admin.email}`);
    console.log(`    role:  ${admin.role}\n`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("❌  Error creating admin user:", err);
  process.exit(1);
});
