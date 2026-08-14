if (process.env.BBBB_PROTECTED_DEPLOY !== "1") {
  console.error(
    "Direct Vercel deployment is blocked. Use the protected deployment workflow.",
  );
  process.exit(1);
}
