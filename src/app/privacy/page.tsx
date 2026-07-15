import Link from "next/link";

export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-12 text-foreground">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <img
            src="/logo-mark.png"
            alt="Growth Saints"
            className="h-10 w-10 rounded-lg object-cover"
          />
          <span className="text-lg font-semibold">Growth Saints CRM</span>
        </div>

        <h1 className="mb-2 text-3xl font-bold">Privacy Policy</h1>
        <p className="mb-10 text-sm text-muted-foreground">
          Last updated: July 15, 2026
        </p>

        <div className="flex flex-col gap-8 text-sm leading-relaxed text-foreground/90">
          <section>
            <p>
              Growth Saints (&quot;Growth Saints&quot;, &quot;we&quot;,
              &quot;us&quot;, or &quot;our&quot;) provides Growth Saints CRM,
              a customer engagement platform that lets businesses manage
              conversations, contacts, and campaigns over WhatsApp using the
              WhatsApp Business Platform provided by Meta Platforms, Inc.
              (&quot;Meta&quot;). This Privacy Policy explains what
              information we collect, how we use it, and the choices you
              have.
            </p>
            <p className="mt-3">
              This policy applies to businesses who sign up for and use
              Growth Saints CRM (&quot;Customers&quot;) and, where relevant,
              to the end customers those businesses message through the
              platform (&quot;Contacts&quot;).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              1. Information We Collect
            </h2>
            <p className="font-medium">Account information</p>
            <p>
              When you create an account, we collect your name, email
              address, and password (or, if you sign in with Google, your
              Google account name, email, and profile photo).
            </p>
            <p className="mt-3 font-medium">
              WhatsApp Business Account information
            </p>
            <p>
              When you connect a WhatsApp Business Account through Meta&apos;s
              Embedded Signup flow, we receive and store information Meta
              provides about that account, including the WhatsApp Business
              Account ID, phone number ID, display name, and an access token
              that lets us send and receive messages on your behalf.
            </p>
            <p className="mt-3 font-medium">Contact and message data</p>
            <p>
              We store the contacts you add or that message your connected
              WhatsApp number, along with the content of messages,
              attachments, templates, and conversation metadata (timestamps,
              delivery/read status), so that your team can view and respond
              to conversations inside the CRM.
            </p>
            <p className="mt-3 font-medium">Payment information</p>
            <p>
              Subscription payments are processed by Razorpay. We store the
              plan, billing status, and transaction history, but we do not
              store your full card or bank details — those are handled
              directly by Razorpay under its own privacy policy.
            </p>
            <p className="mt-3 font-medium">Usage and log data</p>
            <p>
              We automatically collect standard technical data such as IP
              address, browser type, device information, and pages visited,
              to keep the service secure and to diagnose problems.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              2. How We Use Information
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>To operate the CRM: sending/receiving WhatsApp messages, organizing contacts, running campaigns and automations.</li>
              <li>To authenticate you and secure your account.</li>
              <li>To process subscription payments and communicate billing information.</li>
              <li>To provide customer support and respond to your requests.</li>
              <li>To monitor, maintain, and improve the reliability and security of the platform.</li>
              <li>To comply with legal obligations and Meta&apos;s WhatsApp Business Platform policies.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              3. How We Share Information
            </h2>
            <p>We do not sell your personal information. We share data only:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <span className="font-medium">With Meta</span> — messages you
                send/receive and account details necessarily flow through
                Meta&apos;s WhatsApp Business Platform (Cloud API) as part of
                delivering the messaging service, subject to Meta&apos;s own
                data policies.
              </li>
              <li>
                <span className="font-medium">With infrastructure providers</span>{" "}
                — we use Supabase for authentication and database hosting,
                and other cloud providers to run the application. These
                providers process data only on our behalf.
              </li>
              <li>
                <span className="font-medium">With Razorpay</span> — for
                processing subscription payments.
              </li>
              <li>
                <span className="font-medium">For legal reasons</span> — if
                required to comply with a law, regulation, or valid legal
                process.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">4. Data Retention</h2>
            <p>
              We retain account, contact, and message data for as long as
              your account is active, so that your conversation history
              remains available to you. If you close your account, we delete
              or anonymize your data within a reasonable period, except where
              we must retain records to meet legal, accounting, or security
              obligations.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">5. Data Security</h2>
            <p>
              We use industry-standard safeguards — encryption in transit,
              access controls, and row-level security on our database — to
              protect your data. No method of transmission or storage is
              100% secure, but we work to protect your information against
              unauthorized access, alteration, or disclosure.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">6. Your Rights</h2>
            <p>
              You can access, correct, export, or delete your account data
              at any time from within the CRM, or by contacting us. Contacts
              messaged through the platform can ask the business they
              messaged (our Customer) to remove their information; Customers
              are responsible for honoring opt-out requests they receive on
              WhatsApp.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">7. Children&apos;s Privacy</h2>
            <p>
              Growth Saints CRM is a business tool and is not directed at,
              or knowingly used by, children under 18.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">8. Cookies</h2>
            <p>
              We use essential cookies to keep you signed in and to remember
              your preferences (such as theme). We do not use third-party
              advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              9. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. If we make
              material changes, we will update the &quot;Last updated&quot;
              date above and, where appropriate, notify you directly.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">10. Contact Us</h2>
            <p>
              Questions about this Privacy Policy can be sent to{" "}
              <a
                href="mailto:growthsaints@gmail.com"
                className="text-primary hover:text-primary/80"
              >
                growthsaints@gmail.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 flex gap-4 border-t border-border pt-6 text-sm">
          <Link href="/terms" className="text-primary hover:text-primary/80">
            Terms of Service
          </Link>
          <Link href="/login" className="text-primary hover:text-primary/80">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
