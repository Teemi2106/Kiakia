// app/(marketing)/terms/page.tsx
import type { Metadata } from "next";
import { LEGAL, LegalPage, type LegalSection } from "../_components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
  description: "The terms that apply when you order from, sell through or deliver with KiaKia.",
};

const sections: LegalSection[] = [
  {
    title: "Who we are and what KiaKia does",
    body: (
      <>
        <p>
          KiaKia is an online marketplace operated by {LEGAL.entity} (&quot;KiaKia&quot;, &quot;we&quot;,
          &quot;us&quot;) in Nigeria. We connect customers with independent vendors (such as restaurants, kitchens
          and shops) and with independent riders who deliver orders.
        </p>
        <p>
          KiaKia is a platform. Food and goods are prepared and sold by vendors, not by KiaKia, and deliveries are
          carried out by independent riders.
        </p>
      </>
    ),
  },
  {
    title: "Accepting these terms",
    body: (
      <p>
        By creating an account, placing an order, applying as a vendor or otherwise using our website or apps, you
        agree to these terms and to our Privacy Policy. If you do not agree, please do not use KiaKia. You must be at
        least 18 years old, or have a parent or guardian&apos;s permission, to use the service.
      </p>
    ),
  },
  {
    title: "Your account",
    body: (
      <ul>
        <li>Give us accurate information and keep it up to date, including a working email address.</li>
        <li>You must verify your email address with the code we send you before your account is active.</li>
        <li>Keep your password and verification codes private. You are responsible for activity on your account.</li>
        <li>Tell us straight away if you think someone else has accessed your account.</li>
        <li>We may suspend or close accounts that break these terms, are used for fraud, or put others at risk.</li>
      </ul>
    ),
  },
  {
    title: "Ordering as a customer",
    body: (
      <>
        <p>
          When you place an order you make an offer to buy from the vendor. The order is confirmed once the vendor
          accepts it. Vendors set their own menus, prices and preparation times. Preparation and delivery times we
          show are estimates, not guarantees.
        </p>
        <p>
          Check your delivery address and phone number before you pay. If a rider cannot reach you or cannot find
          your address after reasonable effort, the order may be cancelled without a refund of the food cost.
        </p>
      </>
    ),
  },
  {
    title: "Prices, fees and payment",
    body: (
      <>
        <p>
          Prices are shown in Nigerian Naira (₦). The total you pay includes the vendor&apos;s item prices, a delivery
          fee and any service fees shown at checkout. Payments are processed by our payment partner, Monnify. We do
          not see or store your full card details.
        </p>
        <p>
          <strong>Escrow.</strong> When you pay, the money is held securely and is not released to anyone until your
          order is delivered. Delivery is confirmed when you give the rider the delivery code shown in your order. On
          confirmation, the payment is divided between the vendor, the rider (who receives the delivery fee) and
          KiaKia (which keeps its commission and fees).
        </p>
        <p>
          <strong>Wallet.</strong> Some refunds are returned to your KiaKia wallet balance. Wallet balances can be
          used towards future orders, in full or together with a card payment. They cannot be topped up directly and
          are not a bank account, deposit or stored-value product. To have a refund returned to your original payment
          method instead, contact support.
        </p>
      </>
    ),
  },
  {
    title: "Delivery",
    body: (
      <>
        <p>
          Once a vendor marks your order ready, nearby available riders are notified and one of them can accept it.
          Please be reachable and ready to receive the order. Only share your delivery code with the rider when you
          have received your order. Sharing it earlier releases your payment before delivery and we may not be able to
          reverse it.
        </p>
        <p>
          Some vendors deliver orders themselves. The same delivery code process applies.
        </p>
      </>
    ),
  },
  {
    title: "Cancellations, refunds and problems with an order",
    body: (
      <>
        <ul>
          <li>You can cancel before the vendor starts preparing your order. After that, cancellation may not be possible.</li>
          <li>If a vendor cannot fulfil your order or it is not delivered, you will be refunded in full.</li>
          <li>
            If your order arrives wrong, missing items or in unacceptable condition, report it through the app or to{" "}
            {LEGAL.email} as soon as possible, ideally within 24 hours, with photos where relevant. We will review it
            and may refund all or part of the order.
          </li>
          <li>Refunds are returned to your wallet or, where you ask for it and we agree, to your original payment method.</li>
        </ul>
        <p>
          Nothing in this section limits any right you have under Nigerian consumer protection law.
        </p>
      </>
    ),
  },
  {
    title: "Terms for vendors",
    body: (
      <ul>
        <li>
          Vendor applications are reviewed by KiaKia. We may approve, reject, suspend or remove a vendor at our
          discretion, for example for food-safety, quality or conduct concerns.
        </li>
        <li>You confirm you are legally permitted to run your business and that the information you give us is accurate.</li>
        <li>
          You are responsible for your menu, prices, descriptions, allergen information, food safety and compliance
          with all laws and licences that apply to your business.
        </li>
        <li>
          KiaKia charges a commission on the item subtotal of each order, shown in your vendor dashboard. Your payout
          is the subtotal less that commission. Payouts are made after delivery is confirmed.
        </li>
        <li>Prepare orders promptly, and keep your availability and preparation times up to date.</li>
        <li>You may leave at any time. Pending orders and payouts will still be completed.</li>
      </ul>
    ),
  },
  {
    title: "Terms for riders",
    body: (
      <ul>
        <li>Riders are independent contractors, not employees of KiaKia or of any vendor.</li>
        <li>Riders receive the delivery fee for each completed delivery, paid once the delivery code is confirmed.</li>
        <li>Riders must deliver orders safely, obey road traffic laws, and handle food hygienically.</li>
        <li>Riders&apos; location is used while they are online so that nearby orders can be offered to them.</li>
      </ul>
    ),
  },
  {
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>use KiaKia for anything unlawful or fraudulent, including using stolen payment methods;</li>
          <li>create fake accounts, fake orders or false complaints in order to obtain refunds;</li>
          <li>harass, threaten or abuse vendors, riders, customers or our staff;</li>
          <li>interfere with, scrape, reverse-engineer or try to break the security of our services;</li>
          <li>attempt to bypass KiaKia&apos;s payment or delivery-code process.</li>
        </ul>
      </>
    ),
  },
  {
    title: "Our content and your content",
    body: (
      <p>
        The KiaKia name, logo, apps and website are owned by us or our licensors. You may not copy or reuse them
        without permission. If you upload content (such as menu photos or reviews), you keep ownership but give us a
        non-exclusive licence to display and use it to operate and promote KiaKia. You confirm you have the right to
        upload it.
      </p>
    ),
  },
  {
    title: "Availability and changes to the service",
    body: (
      <p>
        We work to keep KiaKia available, but we do not promise it will always be uninterrupted or error-free. We may
        change, pause or discontinue features, and we may update these terms. If we make a significant change we will
        tell you, for example by email or in the app. Continuing to use KiaKia after a change means you accept it.
      </p>
    ),
  },
  {
    title: "Limits on our responsibility",
    body: (
      <>
        <p>
          Because vendors prepare the food and riders make the deliveries, we are not responsible for the quality,
          safety or content of food and goods sold by vendors, or for the conduct of vendors or riders, except where
          the law says we are.
        </p>
        <p>
          To the fullest extent the law allows, KiaKia is not liable for indirect or consequential loss, and our total
          liability to you for any claim relating to an order is limited to the amount you paid for that order. Nothing
          in these terms excludes liability that cannot be excluded by law.
        </p>
      </>
    ),
  },
  {
    title: "Governing law and disputes",
    body: (
      <p>
        These terms are governed by the laws of the Federal Republic of Nigeria. Please contact us first and we will
        try to resolve any complaint informally. If we cannot, the courts of Nigeria have jurisdiction, unless the
        law gives you the right to go elsewhere.
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

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These terms explain the rules for using KiaKia as a customer, vendor or rider. Please read them carefully.
        </p>
      }
      sections={sections}
    />
  );
}
