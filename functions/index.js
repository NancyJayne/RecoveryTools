// index.js (cleaned)
import admin from "firebase-admin";
import dotenv from "dotenv";
dotenv.config();

if (!admin.apps.length) {
  admin.initializeApp();
}


// ✅ Export Functions
// Email functions
export { sendTransactionalEmail } from "./emails/sendTransactionalEmail.js";
export { sendAffiliateWelcomeEmail } from "./emails/sendAffiliateWelcomeEmail.js";
export { sendAdminBroadcastEmail } from "./emails/sendAdminBroadcastEmail.js";
export { onNewReview } from "./emails/onNewReview.js";
export { sendOrderEmailWithPDF } from "./emails/sendOrderEmailWithPDF.js";
export { sendWorkshopTicketEmail } from "./emails/sendWorkshopTicketEmail.js";
export { sendContactMessage } from "./emails/sendContactMessage.js";
export { sendPasswordReset } from "./emails/sendPasswordReset.js";
export { sendWelcomeEmail } from "./emails/sendWelcomeEmail.js";


// Orders
export { confirmStripePurchase } from "./orders/confirmStripePurchase.js";
export { createCheckoutSession } from "./orders/createCheckoutSession.js";
export { getUserOrders } from "./orders/getUserOrders.js";
export { getAllOrdersForAdmin } from "./orders/getAllOrdersForAdmin.js";
export { generateOrderPDF } from "./orders/generateOrderPDF.js";
export { getOrderByInvoiceID } from "./orders/getOrderByInvoiceID.js";

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

// Affiliate
export { createStripeConnectLink } from "./affiliates/createStripeConnectLink.js";
export { createStripeLoginLink } from "./affiliates/createStripeLoginLink.js";
export { registerAffiliate } from "./affiliates/registerAffiliate.js";
export { getAffiliatePerformance } from "./admin/getAffiliatePerformance.js";


// Products
export { createProduct } from "./products/createProduct.js";
export { updateProduct } from "./products/updateProduct.js";
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
export { deleteCourse } from "./courses/deleteCourse.js";
export { deleteWorkshop } from "./workshops/deleteWorkshop.js";

// Webhooks
export { handleStripeWebhook } from "./webhooks/handleStripeWebhook.js";
