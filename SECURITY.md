# Security Policy – Recovery Tools

We take the security and privacy of our users, partners, and affiliates seriously. This document outlines how to report vulnerabilities, how we handle them, and the scope of our security concerns.

---

## 🔐 Supported Versions

| Platform Component           | Supported |
|-----------------------------|-----------|
| Firebase Backend             | ✅ Yes    |
| Recovery Tools Frontend App | ✅ Yes    |
| Admin Panel / CRM           | ✅ Yes    |
| Affiliate System            | ✅ Yes    |

---

## 📣 Reporting a Vulnerability

If you believe you’ve discovered a security vulnerability or data privacy concern in the Recovery Tools platform, **please report it confidentially**.

### Contact

- **Email**: hello@recoverytools.au  
- **Form**: [Contact us](https://recoverytools.au/contact)

Please include:
- A detailed description of the issue
- Steps to reproduce (if known)
- Any relevant logs, screenshots, or proof-of-concept

We will acknowledge your report within **2 business days** and provide status updates as we triage and resolve the issue.

---

## 🔎 Scope of This Policy

We welcome reports on vulnerabilities related to:

### Authentication & Authorization
- Firebase Authentication (Google, Email/Password, OAuth)
- Session hijacking or privilege escalation
- Access control around:
  - Admin dashboard
  - User profiles and purchase data
  - Affiliate and therapist tools

### Payment Systems
- Stripe integration (checkout, subscriptions, payouts)
- Affiliate payment handling (Stripe Express)
- Invoice and transaction ID leakage
- Improper access to paid resources (e.g., downloadables, tickets, courses)

### Data Privacy & Storage
- Firebase Firestore and Storage permissions
- Exposure of sensitive user or affiliate data
- Health data or workshop-related client history
- Improper visibility of admin-only or therapist-only documents

### Email & Communication
- SendGrid API security
- Email injection, spoofing, or abuse
- Leaked or unauthorized messaging

### AI/Content Systems
- Exposure of adult-rated Anato-Me stories to underage users
- Improper content rating logic bypass

### Web & Abuse Protection
- reCAPTCHA bypass
- CSRF, XSS, or clickjacking
- Abuse of content access endpoints (e.g., direct links to restricted programs)

### Other Critical Areas
- Cloud Function abuse or privilege escalation
- Course progress tampering
- Program/workshop ticket reuse or manipulation
- Manipulation of profile upgrades or purchases
- Broken access to admin views or Firestore role leaks

---

## 🏥 Health Data and Compliance

Recovery Tools stores data that may relate to user health conditions, practitioner interactions, and course/workshop content. We strive to comply with **Australian Privacy Principles (APPs)** under the **Privacy Act 1988**, as well as the **OAIC's Health Records Guidelines**.

We are committed to:
- Role-based access to health-related and clinical records
- Proper logging of therapist interactions
- Secure storage of workshop and consultation history
- Transparent data retention and deletion practices
- User rights to access and request correction or deletion

---

## 🧪 Disclosure Guidelines

We follow [responsible disclosure](https://en.wikipedia.org/wiki/Responsible_disclosure) practices:
- Report privately and allow time for remediation
- Avoid public disclosure until we've responded
- We may credit responsible reporters with consent

---

## 🚫 Out-of-Scope Reports

Unless they present a real security risk, the following are generally **not eligible** for prioritization:
- Self-XSS or phishing using your own browser tools
- Issues requiring rooted or jailbroken devices
- Spam or abuse reports not tied to a technical exploit
- Lack of 2FA for users (currently optional, not enforced)

---

## 🛡️ Best Practices for Users and Affiliates

- Do not share login credentials or access links
- Use strong passwords and enable browser security features
- Avoid downloading Recovery Tools content from unauthorized sites
- Immediately report any suspicious login activity or access issues

---

## 📜 Versioning and Changes

This document may be updated at any time as our platform evolves. Last updated: **10 July 2025**

---
Thank you for helping us keep Recovery Tools safe and secure.
