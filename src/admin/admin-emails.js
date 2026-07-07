// Trigger order/affiliate emails
import { db, functions } from "../utils/firebase-config.js";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getUserRole } from "../auth/user-roles.js";
import { showToast } from "../utils/utils.js";

export async function setupAdminEmails() {
  const role = await getUserRole();

  if (
    !(
      role === "admin" ||
    role?.admin === true
    )
  ) {
    return;
  }

  const form = document.getElementById("adminEmailForm");
  if (!form) return;

  const sendBroadcast = httpsCallable(functions, "sendAdminBroadcastEmail");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const subject = document.getElementById("emailSubject")?.value.trim();
    const htmlContent = document.getElementById("emailHtml")?.value.trim();
    const audience = document.getElementById("emailAudience")?.value || "all";

    if (!subject || !htmlContent) {
      showToast("Subject and content required", "error");
      return;
    }

    try {
      let q = collection(db, "users");
      if (audience === "affiliates") {
        q = query(q, where("roles.affiliate", "==", true));
      }
      const snap = await getDocs(q);
      const recipients = snap.docs
        .map((doc) => doc.data()?.email)
        .filter(Boolean);

      if (!recipients.length) {
        showToast("No recipients found", "error");
        return;
      }

      await sendBroadcast({ recipients, subject, htmlContent });
      showToast(`Email sent to ${recipients.length} recipients`, "success");
      form.reset();
    } catch (err) {
      console.error("Broadcast email failed:", err);
      showToast("Failed to send email", "error");
    }
  });
}

export default setupAdminEmails;

