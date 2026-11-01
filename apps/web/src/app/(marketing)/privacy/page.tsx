// app/(marketing)/privacy/page.tsx
import type { Metadata } from "next";
import { LEGAL, LegalPage, type LegalSection } from "../_components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data KiaKia collects, why we use it, who we share it with, and your rights.",
};

const sections: LegalSection[] = [
  {
    title: "Who is responsible for your data",
    body: (
      <p>
        {LEGAL.entity} (&quot;KiaKia&quot;, &quot;we&quot;, &quot;us&quot;) is the data controller for personal data
        processed through our website and apps. We handle personal data in line with the Nigeria Data Protection Act
        2023 and other applicable law.
      </p>
    ),
  },
  {
    title: "What we collect",
    body: (
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address, password (stored only in hashed form) and, where
          you give it, phone number.
        </li>
        <li>
          <strong>Order details:</strong> items ordered, delivery address and notes, order history, delivery codes and
          messages about an order.
        </li>
        <li>
          <strong>Payment information:</strong> payment status, amounts, references and refund or wallet records. Card
          details are entered with our payment partner, Monnify, and are not stored by KiaKia.
        </li>
        <li>
          <strong>Location:</strong> your delivery address and map position. For riders, live location while online.
        </li>
        <li>
          <strong>Vendor and rider information:</strong> business name, registration and contact details, menu
          content, bank account details for payouts, and identity or vehicle details needed to verify riders.
        </li>
        <li>
          <strong>Technical data:</strong> device and browser type, IP address, and cookies needed to keep you signed
          in and remember your selected mode (customer or vendor).
        </li>
      </ul>
    ),
  },
  {
    title: "How and why we use it",
    body: (
      <ul>
        <li>To create and secure your account, including verifying your email with a one-time code.</li>
        <li>To process orders, take payment, hold it in escrow and pay out vendors and riders.</li>
        <li>To match orders with nearby riders and let you and the rider reach each other about a delivery.</li>
        <li>To send order updates and service messages by email, in-app and push notification.</li>
        <li>To provide support, handle refunds and resolve disputes.</li>
        <li>To prevent fraud, abuse and security incidents, and to meet legal and accounting obligations.</li>
        <li>To maintain and improve KiaKia.</li>
      </ul>
    ),
  },
  {
    title: "Our legal bases",
    body: (
      <p>
        We process data to perform our contract with you (running your account and orders), to meet legal
        obligations, for our legitimate interests (security, fraud prevention and improving the service) and, where
        required, with your consent, which you can withdraw at any time.
      </p>
    ),
  },
  {
    title: "Who we share it with",
    body: (
      <>
        <p>We do not sell your personal data. We share it only as needed to run KiaKia:</p>
        <ul>
          <li>
            <strong>Vendors</strong> see the items, name, notes and delivery details needed to prepare and hand over
            your order.
          </li>
          <li>
            <strong>Riders</strong> see the pickup and delivery address, your first name and your contact number for
            the delivery. They do not see your delivery code until you give it to them.
          </li>
          <li>
            <strong>Service providers</strong> acting for us: Monnify (payments and payouts), Supabase (database,
            authentication and hosting), our email delivery provider, and mapping and push-notification services.
          </li>
          <li>
            <strong>Authorities and advisers</strong> where required by law, to enforce our terms, or to protect
            people&apos;s safety and rights.
          </li>
        </ul>
        <p>
          Some providers process data outside Nigeria. Where they do, we rely on safeguards that the Nigeria Data
          Protection Act permits, such as contractual protections.
        </p>
      </>
    ),
  },
  {
    title: "How long we keep it",
    body: (
      <p>
        We keep data for as long as your account is active and as long as needed for the purposes above. Financial and
        order records are kept for the period the law requires, which is generally at least six years. When data is no
        longer needed we delete or anonymise it.
      </p>
    ),
  },
  {
    title: "Security",
    body: (
      <p>
        We protect your data with encryption in transit, hashed passwords, access controls on our database, and
        verification of your email before an account is activated. No system is completely secure, so please use a
        strong, unique password and never share your verification code or delivery code except as described in our
        terms.
      </p>
    ),
  },
  {
    title: "Your rights",
    body: (
      <>
        <p>You have the right to:</p>
        <ul>
          <li>ask for a copy of the personal data we hold about you;</li>
          <li>have inaccurate data corrected;</li>
          <li>ask us to delete your data, subject to records we must keep by law;</li>
          <li>object to or ask us to restrict certain processing, and withdraw consent;</li>
          <li>receive your data in a portable format where it applies;</li>
          <li>complain to the Nigeria Data Protection Commission.</li>
        </ul>
        <p>
          To exercise any of these, email {LEGAL.email}. We may need to verify your identity first.
        </p>
      </>
    ),
  },
  {
    title: "Cookies",
    body: (
      <p>
        We use cookies and similar storage that are necessary for the service: keeping you signed in, protecting your
        session, and remembering whether you are using KiaKia as a customer or a vendor. You can block cookies in your
        browser, but parts of KiaKia will not work without them.
      </p>
    ),
  },
  {
    title: "Children",
    body: (
      <p>
        KiaKia is not intended for children under 18 using the service on their own. If you believe a child has given
        us personal data without a parent&apos;s consent, contact us and we will delete it.
      </p>
    ),
  },
  {
    title: "Changes to this policy",
    body: (
      <p>
        We may update this policy from time to time. The date at the top shows when it last changed, and we will tell
        you about significant changes by email or in the app.
      </p>
    ),
  },
  {
    title: "Contact us",
    body: (
      <p>
        {LEGAL.entity}, {LEGAL.address}
        <br />
        Email: {LEGAL.email}
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          This policy explains what personal data KiaKia collects when you use our website and apps, why we use it, and
          the choices you have.
        </p>
      }
      sections={sections}
    />
  );
}
