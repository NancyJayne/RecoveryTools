// index.js (cleaned)
import admin from "firebase-admin";
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const functionsDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(functionsDir, "../.env") });
dotenv.config({ path: resolve(functionsDir, ".env"), override: true });

if (!admin.apps.length) {
  admin.initializeApp();
}


// ✅ Export Functions
// Email functions
export { sendAffiliateWelcomeEmail } from "./emails/sendAffiliateWelcomeEmail.js";
export { sendAdminBroadcastEmail } from "./emails/sendAdminBroadcastEmail.js";
export { onNewReview } from "./emails/onNewReview.js";
export { sendOrderEmailWithPDF } from "./emails/sendOrderEmailWithPDF.js";
export { sendWorkshopTicketEmail } from "./emails/sendWorkshopTicketEmail.js";
export { sendContactMessage } from "./emails/sendContactMessage.js";
export { sendPasswordReset } from "./emails/sendPasswordReset.js";
export { sendWelcomeEmail } from "./emails/sendWelcomeEmail.js";
export { getEmailLogs } from "./emails/getEmailLogs.js";


// Orders
export { confirmStripePurchase } from "./orders/confirmStripePurchase.js";
export { createCheckoutSession } from "./orders/createCheckoutSession.js";
export { getUserOrders } from "./orders/getUserOrders.js";
export { getAllOrdersForAdmin } from "./orders/getAllOrdersForAdmin.js";
export { getAdminOrderAlerts } from "./orders/getAdminOrderAlerts.js";
export { generateOrderPDF } from "./orders/generateOrderPDF.js";
export { generatePackingSlipPDF } from "./orders/generatePackingSlipPDF.js";
export { getOrderByInvoiceID } from "./orders/getOrderByInvoiceID.js";
export { updateOrderFulfilment } from "./orders/updateOrderFulfilment.js";
export { maintainOrderLifecycle } from "./orders/maintainOrderLifecycle.js";
export { updateOrderArchive } from "./orders/updateOrderArchive.js";
export { submitOrderIssue } from "./orders/submitOrderIssue.js";
export { getOrderIssuesForAdmin } from "./orders/getOrderIssuesForAdmin.js";
export { updateOrderIssueStatus } from "./orders/updateOrderIssueStatus.js";

// Referrals
export { logReferralEvent } from "./referrals/logReferralEvent.js";
export { getReferralStats } from "./referrals/getReferralStats.js";
export { getAffiliatePayouts } from "./referrals/getAffiliatePayouts.js";

// Anato-me
export { deleteAnatoMeEpisode } from "./anato-me/deleteAnatoMeEpisode.js";
export { saveAnatoMeEpisode } from "./anato-me/saveAnatoMeEpisode.js";

// Users
export { createUserProfile } from "./users/createUserProfile.js";
export { setUserRoles } from "./users/setUserRoles.js";
export { getUserRole } from "./users/getUserRole.js";
export { getUserRoleWithPermissions } from "./users/getUserRoleWithPermissions.js";
export { adminResetUserPassword } from "./users/adminResetUserPassword.js";
export { adminCreateUser, sendPasswordReset as PasswordReset } from "./users/authHelpers.js";
export { getUserByEmailOrUID } from "./users/getUserByEmailOrUID.js";
export { searchUsersByName } from "./users/searchUsersByName.js";
export { manageUserProfiles } from "./users/manageUserProfiles.js";

// Affiliate
export { createStripeConnectLink } from "./affiliates/createStripeConnectLink.js";
export { createStripeLoginLink } from "./affiliates/createStripeLoginLink.js";
export { registerAffiliate } from "./affiliates/registerAffiliate.js";
export { getCheckoutAffiliates } from "./affiliates/getCheckoutAffiliates.js";
export { getCheckoutPickupOptions } from "./orders/getCheckoutPickupOptions.js";
export { getAffiliatePerformance } from "./admin/getAffiliatePerformance.js";


// Products
export { createProduct } from "./products/createProduct.js";
export { updateProduct } from "./products/updateProduct.js";
export { updateProductInventory } from "./products/updateProductInventory.js";
export { deleteProduct } from "./products/deleteProduct.js";
export { getFirestoreProducts } from "./products/getFirestoreProducts.js";

// Utils
export { logError } from "./utils/logError.js";
export { generateOrderPDF as generateServerPDF } from "./utils/generateOrderPDFServer.js";
export { verifyRecaptchaToken } from "./utils/verifyRecaptchaToken.js";


// Admin
export { exportAllOrdersCSV } from "./admin/exportAllOrdersCSV.js";
export { getShippingTaxSettings } from "./admin/getShippingTaxSettings.js";
export { updateShippingTaxSettings } from "./admin/updateShippingTaxSettings.js";
export { getUserDashboardStats } from "./admin/getUserDashboardStats.js";
export { approveReview } from "./admin/approveReview.js";
export { getAdminProductReviews } from "./admin/getAdminProductReviews.js";
export { getBusinessSettings } from "./admin/getBusinessSettings.js";
export { updateBusinessSettings } from "./admin/updateBusinessSettings.js";
export { getContentBuilderData } from "./admin/getContentBuilderData.js";
export { exportContentBackup } from "./admin/exportContentBackup.js";
export { createContentBuilderRecord } from "./admin/createContentBuilderRecord.js";
export { upsertContentBuilderTemplate } from "./admin/upsertContentBuilderTemplate.js";
export { updateContentControlRecord } from "./admin/updateContentControlRecord.js";
export { maintainContentLifecycle } from "./admin/maintainContentLifecycle.js";
export { getAdminAssets, upsertAdminAsset } from "./admin/manageAssets.js";
export { submitProductReview } from "./reviews/submitProductReview.js";
export { deleteCourse } from "./courses/deleteCourse.js";
export { deleteWorkshop } from "./workshops/deleteWorkshop.js";

// Webhooks
export { handleStripeWebhook } from "./webhooks/handleStripeWebhook.js";
