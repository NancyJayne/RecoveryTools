// affiliate-entry.js – Main entry point for the Affiliate Dashboard (Lazy Loaded)

export async function setupAffiliateDashboard() {
  const [
    { initAffiliateDashboard },
    { initAffiliateCourseSubmission },
    { initAffiliateWorkshopSubmission },
    { fetchReferralStats },
    { loadAffiliatePayouts },
    { setupStripeButtons },
    { setupAffiliateTimezoneSettings },
  ] = await Promise.all([
    import(new URL("./affiliate-dashboard.js", import.meta.url)),
    import(new URL("./affiliate-courses.js", import.meta.url)),
    import(new URL("./affiliate-workshops.js", import.meta.url)),
    import(new URL("./affiliate-referrals.js", import.meta.url)),
    import(new URL("./affiliate-payouts.js", import.meta.url)),
    import(new URL("./affiliate-stripe.js", import.meta.url)),
    import(new URL("./affiliateSetTimezone.js", import.meta.url)),
  ]);

  // Initialize core dashboard views and forms
  initAffiliateDashboard();
  initAffiliateCourseSubmission();
  initAffiliateWorkshopSubmission();

  // Setup Stripe connect & manage buttons
  setupStripeButtons();

  // Setup timezone dropdowns and save button
  setupAffiliateTimezoneSettings();

  // Load referral analytics
  try {
    const stats = await fetchReferralStats();
    if (stats) {
      document.getElementById("affiliateToolSales").textContent = stats.tool.conversion || 0;
      document.getElementById("affiliateCourseSales").textContent = stats.course.conversion || 0;
      document.getElementById("affiliateWorkshopSales").textContent = stats.workshop.conversion || 0;
    }
  } catch (err) {
    console.warn("Failed to load referral stats", err);
  }

  // Load recent payouts
  try {
    const payouts = await loadAffiliatePayouts();
    console.log("💸 Payouts loaded:", payouts);
  } catch (err) {
    console.warn("Failed to load payouts", err);
  }
}
